//! Python 绑定(scripts/scripting-design.md 阶段 1:方案 B 扩展模块)。
//!
//! 纪律:**不放仿真逻辑**——只转发 sandtable-core(load → validate → run /
//! sweep / recommend / params 只读),与 CLI、wasm 绑定同一内核的第三份薄转发;
//! 等价性由 py_parity 测试锁死(同配置同 seed,results 与 CLI report.json
//! 逐值一致,pytest `tests/`)。本 crate 不链 sandtable-wasm(wasm-bindgen
//! 不进 native crate),core 依赖树零改动,wasm32 门不受影响。
//!
//! 原生形态,无 Web 端的 64 replicates / 200 预算门(设计文档 §4:Python
//! 出现在实验粒度,单次调用可承载真实实验);扫描一次全量调用(候选顺序
//! 执行,同 CLI 语义),更大实验引导走 CLI(rayon 并行)。
//!
//! 对设计文档 §6 草图的偏离(轮记录 2026-10-11):`days` 以 `days_csv`
//! 字符串交付(与 CLI 逐字节同源),Arrow 零拷贝留阶段 2。

use pyo3::conversion::IntoPyObjectExt;
use pyo3::exceptions::{PyTypeError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyAny, PyBool, PyDict, PyList, PyString};

use sandtable_core as core;
use serde_json::{json, Value};

// —— 内部装载(load → validate,与 wasm 绑定同构)——

fn load_config(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

// —— native 层(纯函数,返回 serde_json::Value;pyfunction 薄封装见下)——

/// 运行仿真(native 纯函数):R 个 replicate 的 [`core::metrics::RunMetrics`]
/// 序列化数组,与 CLI `simulate` report.json 的 `results` 逐字段同构
/// (同 seed 同配置时逐值相等,py_parity 锁死)。另附 `days_csv`(replicate 1
/// 的按天 CSV,与 CLI `simulate --out` 写盘产物逐字节一致,文档 09 章契约)。
fn run_simulation_native(yaml: &str, replicates: u32) -> Result<Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let cfg = load_config(yaml)?;
    let results: Vec<core::metrics::RunMetrics> =
        (0..replicates).map(|r| core::sim::run(&cfg, r)).collect();
    Ok(json!({
        "meta": {
            "schema_version": core::SCHEMA_VERSION,
            "model_version": core::MODEL_VERSION,
        },
        "config_hash": core::config::config_hash(&cfg),
        "days_csv": core::export::day_csv(&results[0]),
        "results": results,
    }))
}

/// 全量扫描(native 纯函数):实验 YAML → plan → 顺序跑全部候选(同 CLI
/// 语义;失败候选 config_error 照常上报不静默)。返回 wasm `sweep_plan`
/// 的字段 + `results`(每候选 [`core::sweep::CandidateResult`],含逐指标
/// mean±CI 与判定)。`replicates_override` > 0 时覆盖 sweep.replicates
/// (粗筛语义,同 CLI `sweep --replicates`)。
fn sweep_run_native(yaml: &str, replicates_override: u32) -> Result<Value, String> {
    let (cfg, mut spec) =
        core::scenario::load_experiment_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    if replicates_override > 0 {
        spec.replicates = replicates_override;
        spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    }
    let candidates = spec
        .plan(cfg.base_seed)
        .map_err(|e| format!("配置错误: {e}"))?;
    let results: Vec<core::sweep::CandidateResult> = candidates
        .iter()
        .map(|values| core::sweep::run_candidate(&cfg, &spec, values))
        .collect();
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "base_seed": cfg.base_seed,
        "replicates": spec.replicates,
        "mode": spec.mode,
        "axes": spec.parameters,
        "candidates": candidates,
        "targets": spec.targets,
        "sims": results.len() as u64 * spec.replicates as u64,
        "results": results,
    }))
}

/// 推荐(native 纯函数):敏感性矩阵(OAT 弹性,文档 14 章)+ 单轴推荐
/// 区间(文档 15 章)——只从已有候选结果计算,零额外仿真,与 CLI
/// `recommend` 同源。MVP 红线:仅单参数轴。
fn sweep_recommend_native(yaml: &str, results: &Value) -> Result<Value, String> {
    let (cfg, spec) =
        core::scenario::load_experiment_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    if spec.parameters.len() != 1 {
        return Err(format!(
            "推荐目前只支持单参数轴,sweep 定义了 {} 个参数(多参数联合可行域属后续阶段)",
            spec.parameters.len()
        ));
    }
    let results: Vec<core::sweep::CandidateResult> = serde_json::from_value(results.clone())
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let elasticities =
        core::sensitivity::oat_elasticity(&spec, &cfg, &results, core::sensitivity::DEFAULT_DELTA);
    let recommendation = core::recommend::recommend_axis(&spec, &cfg, &results, 0);
    Ok(json!({ "elasticities": elasticities, "recommendation": recommendation }))
}

// —— serde_json::Value ↔ Python 对象(手写递归,零额外依赖)——
//
// 不引 pyo3/serde feature:转换面就这一对函数,自己写语义更可控
// (u64/i64 → int,f64 → float,Null → None;反向拒绝非字符串键与
// NaN/Inf,JSON 不支持)。

fn value_to_py<'py>(py: Python<'py>, v: &Value) -> PyResult<Bound<'py, PyAny>> {
    Ok(match v {
        Value::Null => py.None().into_bound(py),
        Value::Bool(b) => b.into_py_any(py)?.into_bound(py),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.into_py_any(py)?.into_bound(py)
            } else if let Some(u) = n.as_u64() {
                u.into_py_any(py)?.into_bound(py)
            } else {
                n.as_f64()
                    .expect("JSON number is i64/u64/f64")
                    .into_py_any(py)?
                    .into_bound(py)
            }
        }
        Value::String(s) => s.as_str().into_py_any(py)?.into_bound(py),
        Value::Array(arr) => {
            let list = PyList::empty(py);
            for item in arr {
                list.append(value_to_py(py, item)?)?;
            }
            list.into_any()
        }
        Value::Object(map) => {
            let dict = PyDict::new(py);
            for (k, val) in map {
                dict.set_item(k, value_to_py(py, val)?)?;
            }
            dict.into_any()
        }
    })
}

fn py_to_value(obj: &Bound<'_, PyAny>) -> PyResult<Value> {
    if obj.is_none() {
        return Ok(Value::Null);
    }
    // bool 先于整数判:PyBool 不是 int 的子类不可放行,0/1 不得被吞成 false/true
    if obj.cast::<PyBool>().is_ok() {
        return Ok(Value::Bool(obj.extract::<bool>()?));
    }
    if let Ok(i) = obj.extract::<i64>() {
        return Ok(Value::from(i));
    }
    // u64 在 i64 之后单独判:超出 i64 的整数 Python 是任意精度,落到 f64 会有损
    if let Ok(u) = obj.extract::<u64>() {
        return Ok(Value::from(u));
    }
    if let Ok(f) = obj.extract::<f64>() {
        if !f.is_finite() {
            return Err(PyValueError::new_err("浮点值须有限(JSON 不支持 NaN/Inf)"));
        }
        return Ok(Value::from(f));
    }
    if let Ok(s) = obj.extract::<String>() {
        return Ok(Value::String(s));
    }
    if let Ok(list) = obj.cast::<PyList>() {
        let mut out = Vec::with_capacity(list.len());
        for item in list.iter() {
            out.push(py_to_value(&item)?);
        }
        return Ok(Value::Array(out));
    }
    if let Ok(dict) = obj.cast::<PyDict>() {
        let mut map = serde_json::Map::new();
        for (k, v) in dict {
            let key = k
                .cast::<PyString>()
                .map_err(|_| PyTypeError::new_err("字典键须为字符串(候选参数按路径寻址)"))?
                .to_str()?
                .to_string();
            map.insert(key, py_to_value(&v)?);
        }
        return Ok(Value::Object(map));
    }
    Err(PyTypeError::new_err(format!(
        "不支持的 Python 类型: {}(仅 dict / list / str / int / float / bool / None)",
        obj.get_type().name()?.to_str()?
    )))
}

// —— 已校验配置(pyclass):load 一次,run 复用 ——

/// 已校验配置。字段只读:`yaml`(原文,run 复用)、`config_hash`、
/// `players`、`days`。run 仍走 load → validate 同一纯函数路径(重解析
/// 开销 µs–ms 级,相对仿真可忽略),保证与 `run_str` 语义零分叉。
#[pyclass]
struct Config {
    #[pyo3(get)]
    yaml: String,
    #[pyo3(get)]
    config_hash: String,
    #[pyo3(get)]
    players: u32,
    #[pyo3(get)]
    days: u32,
}

fn make_config(yaml: &str) -> Result<Config, String> {
    let cfg = load_config(yaml)?;
    Ok(Config {
        yaml: yaml.to_string(),
        config_hash: core::config::config_hash(&cfg),
        players: cfg.players,
        days: cfg.days,
    })
}

// —— pyfunction 薄封装(配置错误 / 参数错误 → ValueError,同 CLI 退出码 2 语义)——

/// 装载并校验配置文件 → [`Config`](`load` 的文件版;非法配置抛 ValueError)。
#[pyfunction]
fn load(path: &str) -> PyResult<Config> {
    let yaml = std::fs::read_to_string(path)
        .map_err(|e| PyValueError::new_err(format!("读取失败 {path}: {e}")))?;
    make_config(&yaml).map_err(PyValueError::new_err)
}

/// 装载并校验 YAML 文本 → [`Config`](`load` 的文本版,core `load_str` 同名)。
#[pyfunction]
fn load_str(yaml: &str) -> PyResult<Config> {
    make_config(yaml).map_err(PyValueError::new_err)
}

/// 运行仿真 → dict `{meta, config_hash, days_csv, results}`。
#[pyfunction]
fn run<'py>(
    py: Python<'py>,
    cfg: PyRef<'py, Config>,
    replicates: u32,
) -> PyResult<Bound<'py, PyAny>> {
    let yaml = cfg.yaml.clone();
    let v = run_simulation_native(&yaml, replicates).map_err(PyValueError::new_err)?;
    value_to_py(py, &v)
}

/// 运行仿真(YAML 文本入口)→ dict,形状同 [`run`]。
#[pyfunction]
fn run_str<'py>(py: Python<'py>, yaml: &str, replicates: u32) -> PyResult<Bound<'py, PyAny>> {
    let v = run_simulation_native(yaml, replicates).map_err(PyValueError::new_err)?;
    value_to_py(py, &v)
}

/// 全量扫描实验文件 → dict `{config_hash, players, days, base_seed,
/// replicates, mode, axes, candidates, targets, sims, results}`。
/// `replicates=0` 表示不覆盖(用 YAML 里的 sweep.replicates)。
#[pyfunction]
#[pyo3(signature = (path, replicates = 0))]
fn sweep<'py>(py: Python<'py>, path: &str, replicates: u32) -> PyResult<Bound<'py, PyAny>> {
    let yaml = std::fs::read_to_string(path)
        .map_err(|e| PyValueError::new_err(format!("读取失败 {path}: {e}")))?;
    let v = sweep_run_native(&yaml, replicates).map_err(PyValueError::new_err)?;
    value_to_py(py, &v)
}

/// 平衡推荐(文档 14/15 章):敏感性矩阵 + 单轴推荐区间,只从已有候选
/// 结果计算 → dict `{elasticities, recommendation}`。`results` 传
/// [`sweep`] 返回的 `results` 列表;MVP 红线仅单参数轴。
#[pyfunction]
fn recommend<'py>(
    py: Python<'py>,
    path: &str,
    results: &Bound<'py, PyList>,
) -> PyResult<Bound<'py, PyAny>> {
    let yaml = std::fs::read_to_string(path)
        .map_err(|e| PyValueError::new_err(format!("读取失败 {path}: {e}")))?;
    let v = sweep_recommend_native(&yaml, &py_to_value(results)?).map_err(PyValueError::new_err)?;
    value_to_py(py, &v)
}

/// 参数注册表只读导出(同 CLI `params` 的静态面)→ list[dict]
/// `{path, kind, default, desc}`。只读:写回走 CLI `params import`。
#[pyfunction]
fn params(py: Python<'_>) -> PyResult<Bound<'_, PyList>> {
    let list = PyList::empty(py);
    for spec in core::registry::all() {
        let item = PyDict::new(py);
        item.set_item("path", spec.path)?;
        item.set_item("kind", format!("{:?}", spec.kind).to_lowercase())?;
        item.set_item("default", spec.default)?;
        item.set_item("desc", spec.desc)?;
        list.append(item)?;
    }
    Ok(list)
}

/// Python 模块 `sandtable_sim`(包名待核:PyPI 'sandtable' 已被占用,
/// docs 17;发布前按该章纪律核查候选名)。
#[pymodule]
fn sandtable_sim(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(load, m)?)?;
    m.add_function(wrap_pyfunction!(load_str, m)?)?;
    m.add_function(wrap_pyfunction!(run, m)?)?;
    m.add_function(wrap_pyfunction!(run_str, m)?)?;
    m.add_function(wrap_pyfunction!(sweep, m)?)?;
    m.add_function(wrap_pyfunction!(recommend, m)?)?;
    m.add_function(wrap_pyfunction!(params, m)?)?;
    m.add_class::<Config>()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = "schema_version: '1'\nscenario: {population: 40, duration: '3d', seed: 7}\n";

    const EXP_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );

    #[test]
    fn 载入_有效与无效() {
        let cfg = make_config(YAML).unwrap();
        assert_eq!(cfg.players, 40);
        assert_eq!(cfg.days, 3);
        assert_eq!(cfg.config_hash.len(), 64, "SHA-256 hex");

        let err = match make_config(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n",
        ) {
            Ok(_) => panic!("非法配置应被拒绝"),
            Err(e) => e,
        };
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn 运行_与core直跑逐值一致() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want: Vec<Value> = (0..2u32)
            .map(|r| serde_json::to_value(core::sim::run(&cfg, r)).unwrap())
            .collect();
        assert_eq!(
            v["results"],
            Value::Array(want),
            "results 与 core::sim::run 直序列化逐值一致"
        );
        assert_eq!(
            v["days_csv"].as_str().unwrap(),
            core::export::day_csv(&core::sim::run(&cfg, 0)),
            "days_csv 与 CLI 写盘产物同源同字节"
        );
        assert!(v["meta"]["schema_version"].is_string());

        assert!(run_simulation_native(YAML, 0).is_err());
    }

    #[test]
    fn 扫描_全量候选与replicates覆盖() {
        let v = sweep_run_native(EXP_YAML, 0).unwrap();
        assert_eq!(v["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(v["results"].as_array().unwrap().len(), 3, "全量:每候选一条");
        assert_eq!(v["replicates"], 2);
        assert_eq!(v["sims"], 6);
        assert!(v["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["status"] == "ok"));

        let v = sweep_run_native(EXP_YAML, 1).unwrap();
        assert_eq!(v["replicates"], 1, "覆盖生效(粗筛语义,同 CLI)");
        assert_eq!(v["sims"], 3);

        // 配置错误候选照常上报,不静默丢弃(文档 12 章):轴取注册表路径但候选
        // 值非法(population=0 触发 validate 失败)→ 候选项级 config_error;
        // 未知路径则像 CLI 一样在 plan 期整批拦截,不进扫描
        let bad_yaml = EXP_YAML.replace(
            "model.warrior.attack: {min: 90, max: 110, step: 10}",
            "scenario.population: {min: 0, max: 60, step: 30}",
        );
        let bad = sweep_run_native(&bad_yaml, 0).unwrap();
        let statuses: Vec<&str> = bad["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                // status 两种形态:ok 为字符串,配置错误为对象(带 config_error 键)
                if r["status"].is_string() {
                    r["status"].as_str().unwrap()
                } else {
                    "config_error"
                }
            })
            .collect();
        assert!(statuses.contains(&"config_error"), "{statuses:?}");
        assert!(statuses.contains(&"ok"), "{statuses:?}");
    }

    #[test]
    fn 推荐_单轴区间与双轴拒绝() {
        let v = sweep_run_native(EXP_YAML, 0).unwrap();
        let out = sweep_recommend_native(EXP_YAML, &v["results"]).unwrap();
        let rec = &out["recommendation"];
        assert_eq!(rec["param"], "model.warrior.attack");
        assert_eq!(rec["baseline"], 100.0, "默认 attack 基线");
        assert!(rec["interval"].is_array(), "{rec}");
        assert!(rec["confidence"].is_string());
        assert_eq!(
            out["elasticities"].as_array().unwrap().len(),
            core::experiment::MetricKey::ALL.len()
        );

        let two_axis = EXP_YAML.replace(
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n    model.warrior.defense: {min: 60, max: 80, step: 10}\n",
        );
        let e = sweep_recommend_native(&two_axis, &v["results"]).unwrap_err();
        assert!(e.contains("单参数轴"), "{e}");
    }

    #[test]
    fn 转换器_value到python再回value往返一致() {
        Python::initialize();
        Python::attach(|py| {
            let v = json!({"a": 1, "big": 18446744073709551615u64, "f": 1.5,
                           "s": "文本", "b": true, "n": null,
                           "arr": [1, 2.5, "x", false, null],
                           "nest": {"deep": {"k": 42}}});
            let obj = value_to_py(py, &v).unwrap();
            let back = py_to_value(&obj).unwrap();
            assert_eq!(v, back, "往返逐值一致");
        });
    }

    #[test]
    fn 转换器_非法输入拒绝() {
        Python::initialize();
        Python::attach(|py| {
            // 非字符串键
            let dict = PyDict::new(py);
            dict.set_item(1, "x").unwrap();
            assert!(py_to_value(dict.as_any()).is_err());
            // NaN(JSON 不支持)
            let nan = py.eval(c"float('nan')", None, None).unwrap();
            assert!(py_to_value(&nan).is_err());
            // 任意对象
            let obj = py.eval(c"object()", None, None).unwrap();
            assert!(py_to_value(&obj).is_err());
        });
    }

    #[test]
    fn 参数表_非空且字段齐() {
        Python::initialize();
        Python::attach(|py| {
            let list = params(py).unwrap();
            assert!(list.len() >= 50, "注册表 {}", list.len());
            let first = list.get_item(0).unwrap();
            let dict = first.cast::<PyDict>().unwrap();
            for key in ["path", "kind", "default", "desc"] {
                assert!(dict.get_item(key).unwrap().is_some(), "{key} 缺失");
            }
        });
    }
}
