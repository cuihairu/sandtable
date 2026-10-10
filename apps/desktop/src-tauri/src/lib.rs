// sandtable 桌面壳(Phase 7,拍板 2026-10-10:Linux 本机先行):
// Tauri 2 壳 + sandtable-core path 依赖直连——native 仿真,不经 wasm 边界。
// 命令面不含仿真语义:加载(错误透出)→ 逐 replicate 仿真 → 结果按
// CLI report.json / wasm run_simulation_native 的 results 同构序列化。
// 自动更新器、签名证书按拍板后置。native 无 WASM 的 64 replicates /
// 200 预算门,更大实验本就是桌面定位(文档 09 章边界)。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            validate_config,
            run_simulation,
            sweep_plan,
            sweep_candidate,
            sweep_recommend,
            query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 加载 + 校验(错误前缀与 wasm 绑定同源,前端处理一致)。
fn load(yaml: &str) -> Result<sandtable_core::config::SimConfig, String> {
    let cfg = sandtable_core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    sandtable_core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

/// 校验配置:`{config_hash, players, days, schema_version, model_version}`;
/// 与 wasm validate_config 逐字段同构。
#[tauri::command]
fn validate_config(yaml: String) -> Result<serde_json::Value, String> {
    let cfg = load(&yaml)?;
    Ok(serde_json::json!({
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "schema_version": sandtable_core::SCHEMA_VERSION,
        "model_version": sandtable_core::MODEL_VERSION,
    }))
}

/// 运行仿真:`{meta, config_hash, days_csv, results}`;与 wasm
/// run_simulation_native 逐字段同构,days_csv 与 CLI simulate --out 同字节。
#[tauri::command]
fn run_simulation(yaml: String, replicates: u32) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let cfg = load(&yaml)?;
    let results: Vec<sandtable_core::metrics::RunMetrics> = (0..replicates)
        .map(|r| sandtable_core::sim::run(&cfg, r))
        .collect();
    Ok(serde_json::json!({
        "meta": {
            "schema_version": sandtable_core::SCHEMA_VERSION,
            "model_version": sandtable_core::MODEL_VERSION,
        },
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "days_csv": sandtable_core::export::day_csv(&results[0]),
        "results": results,
    }))
}

/// 扫描计划:实验 YAML → `{config_hash, players, days, base_seed, replicates,
/// mode, axes, candidates, targets, sims}`(无 Web 预算门;候选上限在
/// SweepSpec::validate 内);与 wasm sweep_plan 同构。
#[tauri::command]
fn sweep_plan(yaml: String, replicates_override: u32) -> Result<serde_json::Value, String> {
    let (cfg, mut spec) = sandtable_core::scenario::load_experiment_str(&yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    if replicates_override > 0 {
        spec.replicates = replicates_override;
        spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    }
    let candidates = spec
        .plan(cfg.base_seed)
        .map_err(|e| format!("配置错误: {e}"))?;
    let sims = candidates.len() as u64 * spec.replicates as u64;
    Ok(serde_json::json!({
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "base_seed": cfg.base_seed,
        "replicates": spec.replicates,
        "mode": spec.mode,
        "axes": spec.parameters,
        "candidates": candidates,
        "targets": spec.targets,
        "sims": sims,
    }))
}

/// 单候选运行:`run_candidate` 转发(应用参数 → validate → R replicate →
/// 汇总 → 约束判定);与 wasm sweep_candidate 同构。
#[tauri::command]
fn sweep_candidate(
    yaml: String,
    replicates: u32,
    values_json: String,
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let (cfg, mut spec) = sandtable_core::scenario::load_experiment_str(&yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    spec.replicates = replicates;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let values: std::collections::BTreeMap<String, f64> = serde_json::from_str(&values_json)
        .map_err(|e| format!("参数错误: 候选参数解析失败: {e}"))?;
    serde_json::to_value(sandtable_core::sweep::run_candidate(&cfg, &spec, &values))
        .map_err(|e| format!("候选结果序列化失败: {e}"))
}

/// 推荐:敏感性矩阵(OAT)+ 单轴推荐区间,零额外仿真;MVP 红线:仅单参数轴
/// (与 CLI recommend / wasm sweep_recommend 同源拒绝)。
#[tauri::command]
fn sweep_recommend(yaml: String, results_json: String) -> Result<serde_json::Value, String> {
    let (cfg, spec) = sandtable_core::scenario::load_experiment_str(&yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    if spec.parameters.len() != 1 {
        return Err(format!(
            "推荐目前只支持单参数轴,sweep 定义了 {} 个参数(多参数联合可行域属后续阶段)",
            spec.parameters.len()
        ));
    }
    let results: Vec<sandtable_core::sweep::CandidateResult> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let elasticities = sandtable_core::sensitivity::oat_elasticity(
        &spec,
        &cfg,
        &results,
        sandtable_core::sensitivity::DEFAULT_DELTA,
    );
    let recommendation = sandtable_core::recommend::recommend_axis(&spec, &cfg, &results, 0);
    Ok(serde_json::json!({ "elasticities": elasticities, "recommendation": recommendation }))
}

/// 本地分析层(文档 09 章红线:DuckDB 只读结果,不进仿真路径):输入文件
/// 按词根注册视图(summary.csv → summary;parquet 走 read_parquet),跑 SQL
/// 返回 `{columns, rows}`;与 CLI `query` 子命令同源(视图名 is_ident 拦注入、
/// 列名走 DESCRIBE、单元格转显示文本)。
#[tauri::command]
fn query(inputs: Vec<String>, sql: String) -> Result<serde_json::Value, String> {
    use duckdb::types::ValueRef;
    use duckdb::Connection;

    let conn = Connection::open_in_memory().map_err(|e| format!("打开 DuckDB 内存库失败: {e}"))?;
    for path in &inputs {
        let stem = path
            .rsplit(['/', '\\'])
            .next()
            .and_then(|s| s.rsplit_once('.'))
            .map(|(stem, _)| stem)
            .ok_or_else(|| format!("无法从 {path} 取视图名"))?;
        if !is_ident(stem) {
            return Err(format!(
                "视图名 {stem:?} 非法:文件名词根须为 [A-Za-z_][A-Za-z0-9_]*"
            ));
        }
        // 路径进 DDL 字面量:单引号翻倍(视图名已在 is_ident 拦住)
        let p = path.replace('\'', "''");
        let ddl = if path.ends_with(".parquet") {
            format!("CREATE VIEW {stem} AS SELECT * FROM read_parquet('{p}')")
        } else {
            format!("CREATE VIEW {stem} AS SELECT * FROM read_csv_auto('{p}', header = true)")
        };
        conn.execute_batch(&ddl)
            .map_err(|e| format!("注册视图 {stem} 失败: {e}"))?;
    }

    // 列名取自 DESCRIBE(计划期元数据,不执行查询体):prepare 阶段的
    // C API 不暴露结果列,column_names 要执行后才可用
    let sql = sql.trim().trim_end_matches(';');
    let mut desc = conn
        .prepare(&format!("DESCRIBE {sql}"))
        .map_err(|e| format!("查询准备失败: {e}"))?;
    let mut dcur = desc.query([]).map_err(|e| format!("查询准备失败: {e}"))?;
    let mut names = Vec::new();
    while let Some(r) = dcur.next().map_err(|e| format!("查询准备失败: {e}"))? {
        let n: String = r.get(0).map_err(|e| format!("列名读取失败: {e}"))?;
        names.push(n);
    }

    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("查询准备失败: {e}"))?;
    let ncols = names.len();
    let mut rows = Vec::new();
    let mut cur = stmt.query([]).map_err(|e| format!("查询执行失败: {e}"))?;
    while let Some(r) = cur.next().map_err(|e| format!("查询执行失败: {e}"))? {
        let mut row = Vec::with_capacity(ncols);
        for i in 0..ncols {
            let s = match r.get_ref(i).map_err(|e| format!("单元格读取失败: {e}"))? {
                ValueRef::Null => String::new(),
                ValueRef::Boolean(v) => v.to_string(),
                ValueRef::TinyInt(v) => v.to_string(),
                ValueRef::SmallInt(v) => v.to_string(),
                ValueRef::Int(v) => v.to_string(),
                ValueRef::BigInt(v) => v.to_string(),
                ValueRef::HugeInt(v) => v.to_string(),
                ValueRef::UTinyInt(v) => v.to_string(),
                ValueRef::USmallInt(v) => v.to_string(),
                ValueRef::UInt(v) => v.to_string(),
                ValueRef::UBigInt(v) => v.to_string(),
                ValueRef::Float(v) => v.to_string(),
                ValueRef::Double(v) => v.to_string(),
                ValueRef::Decimal(v) => v.to_string(),
                ValueRef::Text(v) => String::from_utf8_lossy(v).into_owned(),
                ValueRef::Blob(v) => String::from_utf8_lossy(v).into_owned(),
                other => format!("{other:?}"),
            };
            row.push(s);
        }
        rows.push(row);
    }
    Ok(serde_json::json!({ "columns": names, "rows": rows }))
}

/// 视图名须是合法标识符(拼进 DDL,注入在注册处拦截)。
fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

#[cfg(test)]
mod tests {
    // 不用 use super::*:command 宏在同模块生成隐藏 item,重导入会 E0255
    use super::*;

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );
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
    fn 校验_有效与无效() {
        let v = validate_config(YAML.into()).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert!(v["config_hash"].as_str().unwrap().len() == 64);
        assert!(validate_config(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n".into()
        )
        .unwrap_err()
        .starts_with("配置错误"));
    }

    #[test]
    fn 运行_与wasm同构() {
        let v = run_simulation(YAML.into(), 2).unwrap();
        let results = v["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["config_hash"], results[1]["config_hash"]);
        assert!(v["days_csv"].as_str().unwrap().starts_with("day,active,"));
        assert_eq!(v["meta"]["schema_version"], sandtable_core::SCHEMA_VERSION);
        assert!(run_simulation(YAML.into(), 0).is_err());
    }

    #[test]
    fn 扫描_plan_candidate_recommend_与core直跑一致() {
        let plan = sweep_plan(EXP_YAML.into(), 0).unwrap();
        assert_eq!(plan["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(plan["sims"], 6);

        let values = r#"{"model.warrior.attack": 100.0}"#;
        let cand = sweep_candidate(EXP_YAML.into(), 2, values.into()).unwrap();
        let (cfg, spec) = sandtable_core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let want = sandtable_core::sweep::run_candidate(
            &cfg,
            &spec,
            &std::collections::BTreeMap::from([("model.warrior.attack".into(), 100.0)]),
        );
        assert_eq!(cand, serde_json::to_value(want).unwrap());

        let mut results = Vec::new();
        for values in spec.plan(cfg.base_seed).unwrap() {
            results.push(sandtable_core::sweep::run_candidate(&cfg, &spec, &values));
        }
        let results_json = serde_json::to_string(&results).unwrap();
        let v = sweep_recommend(EXP_YAML.into(), results_json).unwrap();
        assert_eq!(v["recommendation"]["param"], "model.warrior.attack");
        assert_eq!(
            v["elasticities"].as_array().unwrap().len(),
            sandtable_core::experiment::MetricKey::ALL.len()
        );
        assert!(sweep_candidate(EXP_YAML.into(), 0, values.into()).is_err());
        assert!(sweep_recommend("no sweep".into(), "[]".into()).is_err());
    }

    #[test]
    fn 运行_与wasm绑定同配置同seed逐值一致() {
        // 三角口径(文档 18 章 Phase 7 验收):web_parity 已锁 wasm↔CLI
        // 逐值一致,本测试锁 desktop↔wasm——两条腿合起来,桌面与 CLI
        // 同配置同 seed 产物等价(同一内核的三个入口)。配置用宝可梦案例,
        // 与 web_parity 同源,覆盖 dungeon / progression 真实形状。
        let yaml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../examples/pokemon.yaml"
        ))
        .unwrap();
        let v = run_simulation(yaml.clone(), 2).unwrap();
        let w = sandtable_wasm::run_simulation_native(&yaml, 2).unwrap();
        assert_eq!(v["results"], w["results"], "results 逐值一致");
        assert_eq!(v["config_hash"], w["config_hash"], "config_hash 一致");
        assert_eq!(v["days_csv"], w["days_csv"], "days_csv 逐字节一致");
    }

    #[test]
    fn 查询_csv视图() {
        let dir = std::env::temp_dir().join(format!("st-desktop-query-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("summary.csv");
        std::fs::write(&f, "a,b\n1,2\n3,4\n").unwrap();
        let v = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT sum(a) AS s, count(*) AS n FROM summary".into(),
        )
        .unwrap();
        assert_eq!(v["columns"], serde_json::json!(["s", "n"]));
        assert_eq!(v["rows"], serde_json::json!([["4", "2"]]));
        std::fs::remove_dir_all(&dir).ok();
    }
}
