// sandtable 桌面壳(Phase 7,拍板 2026-10-10:Linux 本机先行):
// Tauri 2 壳 + sandtable-core path 依赖直连——native 仿真,不经 wasm 边界。
// 命令面不含仿真语义:加载(错误透出)→ 逐 replicate 仿真 → 结果按
// CLI report.json / wasm run_simulation_native 的 results 同构序列化。
// 长任务(run_simulation)走异步命令 + spawn_blocking:逐 replicate 经
// Channel 上报进度,replicate 边界响应取消令牌(内核无中途退出面,粒度
// 刻意落在 replicate 之间,仿真语义零改动)。自动更新器、签名证书按拍板
// 后置。native 无 WASM 的 64 replicates / 200 预算门,更大实验本就是
// 桌面定位(文档 09 章边界)。
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::path::BaseDirectory;
use tauri::webview::DownloadEvent;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};

/// 长任务进度事件:`done` / `total` 为 replicate 计数(与 CLI `--replicates`
/// 同口径),前端据此画进度条。
#[derive(Clone, serde::Deserialize, serde::Serialize)]
struct ProgressEvent {
    done: u32,
    total: u32,
}

/// 取消令牌:活动任务在 replicate 边界轮询。
type CancelFlag = Arc<AtomicBool>;

/// 活动长任务登记:桌面同一时刻只认一个活动令牌(`run_simulation`),
/// 取消无需任务 id,前端 `cancel_run` 即可命中。
#[derive(Default)]
struct TaskRegistry(Mutex<Option<CancelFlag>>);

impl TaskRegistry {
    /// 登记新令牌(顶替遗留令牌——上一任务若因 panic 未清理,不堵新任务)。
    fn register(&self) -> CancelFlag {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let flag = Arc::new(AtomicBool::new(false));
        *slot = Some(flag.clone());
        flag
    }

    /// 结束清理;返回被清走的令牌(测试据此断言登记生命周期)。
    fn take(&self) -> Option<CancelFlag> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    /// 置位活动令牌;无活动任务时为无操作。返回是否有任务被命中。
    fn cancel_active(&self) -> bool {
        let slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match &*slot {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(TaskRegistry::default())
        .invoke_handler(tauri::generate_handler![
            validate_config,
            param_registry,
            param_values,
            param_apply,
            kpi_availability,
            ab_compare,
            daily_aggregate,
            run_simulation,
            cancel_run,
            sweep_plan,
            sweep_candidate,
            sweep_recommend,
            query,
        ])
        .setup(|app| {
            // 主窗在此构建而非由 tauri.conf.json 自动建:download 拦截必须挂在
            // WebviewBuilder 上,配置窗口建完无法补挂——无 decide-destination
            // 应答时 WebKitGTK 直接取消下载,前端 blob 锚点下载在桌面静默失效
            // (docs 18 Phase 7 清单第 6 步)。
            let window = WebviewWindowBuilder::new(app.handle(), "main", WebviewUrl::default())
                .title("sandtable")
                .inner_size(1280.0, 840.0)
                .on_download(|webview, event| match event {
                    DownloadEvent::Requested { destination, .. } => {
                        let name = destination
                            .file_name()
                            .map(|n| n.to_string_lossy().into_owned())
                            .filter(|n| !n.is_empty())
                            .unwrap_or_else(|| "download".to_owned());
                        *destination =
                            download_destination(&download_dir(webview.app_handle()), &name);
                        true
                    }
                    DownloadEvent::Finished { success, .. } => {
                        // 无头走查(桌面冒烟脚本)靠这行判定下载是否真的落盘
                        eprintln!("下载{success}");
                        false
                    }
                    _ => false,
                });
            window.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 下载目录:Download 定位失败(无 XDG 下载目录)回退到 家目录/Downloads;
/// 目录不存在时补建——WebKit 写入不存在的目录会直接失败。
fn download_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .resolve("", BaseDirectory::Download)
        .unwrap_or_else(|_| {
            let mut p = std::env::home_dir().unwrap_or_else(|| PathBuf::from("."));
            p.push("Downloads");
            p
        });
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 下载落点:重名加序号,不静默覆盖上一次导出的产物。
fn download_destination(dir: &Path, name: &str) -> PathBuf {
    // 点号前的整体当干,name 形如 days.tar.gz 时只截最后一节
    let (stem, ext) = match name.split_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_owned(), Some(e.to_owned())),
        _ => (name.to_owned(), None),
    };
    let mut n = 0u32;
    loop {
        let cand = if n == 0 {
            dir.join(name)
        } else {
            dir.join(match &ext {
                Some(e) => format!("{stem} ({n}).{e}"),
                None => format!("{stem} ({n})"),
            })
        };
        if !cand.exists() {
            return cand;
        }
        n += 1;
    }
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

/// 参数定义注册表:静态全量 {path, kind, default, desc}(WB-03.04),
/// 与 wasm param_registry 逐字段同构(core 直连,不经 wasm 边界)。
#[tauri::command]
fn param_registry() -> serde_json::Value {
    serde_json::json!(sandtable_core::registry::all().cloned().collect::<Vec<_>>())
}

/// 当前配置数值读取:{path: 当前生效值}(WB-03.05),与 wasm param_values
/// 同构——数值槽逐路径 read_numeric;非数值槽缺键 ≠ 0;loot/gacha 未配置
/// 返回内核真实生效缺省,不拿注册表 default 补值。u64 槽位走无损通道
/// (WB-03.08):≤ 2^53−1 是 JSON 数字,超出 JS 安全整数以十进制字符串
/// 无损表达,不静默舍入。
#[tauri::command]
fn param_values(yaml: String) -> Result<serde_json::Value, String> {
    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    let cfg = load(&yaml)?;
    let mut out = serde_json::Map::new();
    for spec in sandtable_core::registry::all() {
        if let Some(raw) = sandtable_core::registry::read_u64_raw(&cfg, spec.path) {
            let v = if raw <= MAX_SAFE {
                serde_json::json!(raw)
            } else {
                serde_json::json!(raw.to_string())
            };
            out.insert(spec.path.to_string(), v);
            continue;
        }
        if let Ok(v) = sandtable_core::registry::read_numeric(&cfg, spec.path) {
            out.insert(spec.path.to_string(), serde_json::json!(v));
        }
    }
    Ok(serde_json::Value::Object(out))
}

/// 数值参数应用:内核寻址 apply_numeric 单条编辑,应用后重验(显式性契约
/// 在编辑期报错,如半配置 loot),返回应用后 config_hash 与回读值
/// (WB-03.06),与 wasm param_apply 同构。
#[tauri::command]
fn param_apply(yaml: String, path: String, value: f64) -> Result<serde_json::Value, String> {
    let mut cfg = load(&yaml)?;
    sandtable_core::registry::apply_numeric(&mut cfg, &path, value)
        .map_err(|e| format!("配置错误: {e}"))?;
    sandtable_core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    let back = sandtable_core::registry::read_numeric(&cfg, &path)
        .map_err(|e| format!("配置错误: {e}"))?;
    Ok(serde_json::json!({
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "path": path,
        "value": back,
    }))
}

/// KPI 可用性:内核 MetricKey::ALL 逐项 unavailable_reason,返回
/// [{metric, reason}](空 = 全部可用)(WB-03.09),与 wasm 同构。
#[tauri::command]
fn kpi_availability(yaml: String) -> Result<serde_json::Value, String> {
    let cfg = load(&yaml)?;
    Ok(serde_json::json!(
        sandtable_core::experiment::MetricKey::ALL
            .iter()
            .filter_map(|k| {
                sandtable_core::experiment::MetricKey::unavailable_reason(*k, &cfg)
                    .map(|reason| serde_json::json!({ "metric": k.name(), "reason": reason }))
            })
            .collect::<Vec<_>>()
    ))
}

/// A/B 统计比较(WB-03.10):双臂 YAML + 双臂已跑 results JSON 进内核,
/// 成对前提与指标可用性由 core::experiment::compare_arms 显式判定,
/// 配对统计结论内核直出,前端不另算(WB-03.11),与 wasm ab_compare 同构。
/// 指标名 / results JSON 解析失败是 参数错误,其余走 配置错误 通道。
#[tauri::command]
fn ab_compare(
    base_yaml: String,
    cand_yaml: String,
    metric: String,
    results_a_json: String,
    results_b_json: String,
) -> Result<serde_json::Value, String> {
    let key = sandtable_core::experiment::MetricKey::parse(&metric).ok_or_else(|| {
        let all = sandtable_core::experiment::MetricKey::ALL
            .iter()
            .map(|k| k.name())
            .collect::<Vec<_>>()
            .join(", ");
        format!("参数错误: 未知指标 {metric}(可选:{all})")
    })?;
    let cfg_a = load(&base_yaml)?;
    let cfg_b = load(&cand_yaml)?;
    let arm_a: Vec<sandtable_core::metrics::RunMetrics> = serde_json::from_str(&results_a_json)
        .map_err(|e| format!("参数错误: base 臂结果解析失败: {e}"))?;
    let arm_b: Vec<sandtable_core::metrics::RunMetrics> = serde_json::from_str(&results_b_json)
        .map_err(|e| format!("参数错误: cand 臂结果解析失败: {e}"))?;
    let comparison = sandtable_core::experiment::compare_arms(&cfg_a, &cfg_b, key, &arm_a, &arm_b)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(&comparison).map_err(|e| format!("配置错误: {e}"))
}

/// 逐日跨 replicate 聚合(P2 内核导出面):同一候选多份已跑 results JSON
/// 进内核,天数交集、可选字段缺席与 CI 口径均由
/// `core::experiment::daily_aggregate_metrics` 直出,与 wasm 同构。
/// 桥接层不改写统计值;前端不基于单次 days.csv 自算置信带。
#[tauri::command]
fn daily_aggregate(results_json: String) -> Result<serde_json::Value, String> {
    let results: Vec<sandtable_core::metrics::RunMetrics> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 逐日聚合结果解析失败: {e}"))?;
    let aggregation = sandtable_core::experiment::daily_aggregate_metrics(&results)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(aggregation).map_err(|e| format!("配置错误: {e}"))
}

/// 逐 replicate 执行:每个 replicate 开跑前检查取消令牌,完成后上报一次进度。
/// 取消返回 Err 且不产出半截结果——少 replicate 的 results 过不了实验层
/// 汇总口径(CI₉₅ 按 replicate 数算),宁缺毋错。
fn run_replicates(
    cfg: &sandtable_core::config::SimConfig,
    replicates: u32,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(u32),
) -> Result<Vec<sandtable_core::metrics::RunMetrics>, String> {
    let mut results = Vec::with_capacity(replicates as usize);
    for r in 0..replicates {
        if cancel.load(Ordering::Relaxed) {
            return Err(format!("已取消: 完成 {r}/{replicates} replicate"));
        }
        results.push(sandtable_core::sim::run(cfg, r));
        progress(r + 1);
    }
    Ok(results)
}

/// 运行仿真命令体:`{meta, config_hash, days_csv, results}`;与 wasm
/// run_simulation_native 逐字段同构,days_csv 与 CLI simulate --out 同字节。
fn run_simulation_impl(
    yaml: &str,
    replicates: u32,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(u32),
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let cfg = load(yaml)?;
    let results = run_replicates(&cfg, replicates, cancel, progress)?;
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

/// 运行仿真(异步长任务):CPU 重活在 spawn_blocking 线程跑,不占主线程/
/// 异步运行时;逐 replicate 进度经 `onProgress` Channel 推给前端,取消走
/// `cancel_run`(replicate 边界生效)。Channel 不能套 Option(非 Deserialize,
/// 只能作裸命令参数),故 onProgress 为必传——前端唯一调用方同步更新。
#[tauri::command]
async fn run_simulation(
    yaml: String,
    replicates: u32,
    on_progress: Channel<ProgressEvent>,
    state: State<'_, TaskRegistry>,
) -> Result<serde_json::Value, String> {
    let flag = state.register();
    let total = replicates;
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut emit = Box::new(move |done| {
            let _ = on_progress.send(ProgressEvent { done, total });
        });
        run_simulation_impl(&yaml, replicates, &flag, &mut emit)
    })
    .await
    .unwrap_or_else(|e| Err(format!("仿真任务被中断: {e}")));
    state.take();
    out
}

/// 取消活动长任务(`run_simulation`);replicate 边界生效,已结束/无任务时
/// 为无操作。返回是否命中活动任务(前端据此提示)。
#[tauri::command]
fn cancel_run(state: State<'_, TaskRegistry>) -> bool {
    state.cancel_active()
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
fn sweep_candidate_impl(
    yaml: &str,
    replicates: u32,
    values_json: &str,
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let (cfg, mut spec) = sandtable_core::scenario::load_experiment_str(yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    spec.replicates = replicates;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let values: std::collections::BTreeMap<String, f64> = serde_json::from_str(values_json)
        .map_err(|e| format!("参数错误: 候选参数解析失败: {e}"))?;
    serde_json::to_value(sandtable_core::sweep::run_candidate(&cfg, &spec, &values))
        .map_err(|e| format!("候选结果序列化失败: {e}"))
}

/// 单候选运行(异步):replicate 循环在 core `run_candidate` 内部,进度与
/// 取消不在本命令粒度——扫描的候选级进度/中止由前端在候选循环边界处理,
/// 候选内 replicate 级控制需内核暴露观测面,刻意不做(与内核解耦)。
/// 异步化只为长候选不占主线程。
#[tauri::command]
async fn sweep_candidate(
    yaml: String,
    replicates: u32,
    values_json: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sweep_candidate_impl(&yaml, replicates, &values_json)
    })
    .await
    .unwrap_or_else(|e| Err(format!("候选任务被中断: {e}")))
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
    use tauri::ipc::{Channel, InvokeResponseBody};

    fn fresh_flag() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

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
    fn validate_valid_and_invalid() {
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
    fn ab_compare_matches_kernel_semantics() {
        let cand = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_impl(YAML, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let b = run_simulation_impl(cand, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let v = ab_compare(
            YAML.into(),
            cand.into(),
            "win_rate".into(),
            a["results"].to_string(),
            b["results"].to_string(),
        )
        .unwrap();
        assert_eq!(v["metric"], "win_rate");
        assert_eq!(v["arm_a"]["n"], 4);
        assert!(["BHigher", "AHigher", "NoDifference"].contains(&v["verdict"].as_str().unwrap()));
        // 错误通道:未知指标是参数错误;种子错位是配置错误(与 wasm 同构)
        assert!(ab_compare(
            YAML.into(),
            YAML.into(),
            "winrate".into(),
            a["results"].to_string(),
            a["results"].to_string(),
        )
        .unwrap_err()
        .starts_with("参数错误"));
        let other_seed = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let c = run_simulation_impl(other_seed, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let err = ab_compare(
            YAML.into(),
            other_seed.into(),
            "win_rate".into(),
            a["results"].to_string(),
            c["results"].to_string(),
        )
        .unwrap_err();
        assert!(
            err.starts_with("配置错误") && err.contains("base_seed 不一致"),
            "{err}"
        );
    }

    #[test]
    fn run_matches_wasm() {
        let v = run_simulation_impl(YAML, 2, &fresh_flag(), &mut |_| {}).unwrap();
        let results = v["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["config_hash"], results[1]["config_hash"]);
        assert!(v["days_csv"].as_str().unwrap().starts_with("day,active,"));
        assert_eq!(v["meta"]["schema_version"], sandtable_core::SCHEMA_VERSION);
        assert!(run_simulation_impl(YAML, 0, &fresh_flag(), &mut |_| {}).is_err());
    }

    /// 进度回调逐 replicate 上报且不打乱仿真:与无进度路径的结果逐值一致。
    #[test]
    fn run_replicates_reports_progress_per_replicate() {
        let cfg = load(YAML).unwrap();
        let mut seen = Vec::new();
        let results = run_replicates(&cfg, 3, &fresh_flag(), &mut |done| seen.push(done)).unwrap();
        assert_eq!(seen, vec![1, 2, 3]);
        let plain: Vec<_> = (0..3u32)
            .map(|r| sandtable_core::sim::run(&cfg, r))
            .collect();
        assert_eq!(
            serde_json::to_value(&results).unwrap(),
            serde_json::to_value(&plain).unwrap(),
            "进度回调不得改变仿真结果"
        );
    }

    /// 取消在 replicate 边界生效:第 2 个 replicate 完成后置位,第 3 个不再
    /// 开跑;错误信息带已完成计数,且不产出半截结果。
    #[test]
    fn run_replicates_cancels_at_replicate_boundary() {
        let cfg = load(YAML).unwrap();
        let cancel = fresh_flag();
        let mut last_done = 0;
        let err = run_replicates(&cfg, 5, &cancel, &mut |done| {
            last_done = done;
            if done == 2 {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .unwrap_err();
        assert_eq!(last_done, 2);
        assert!(err.contains("已取消"), "{err}");
        assert!(err.contains("2/5"), "{err}");

        // 开跑前已取消:0 个 replicate 完成,计数 0/5
        let pre = fresh_flag();
        pre.store(true, Ordering::Relaxed);
        let err = run_replicates(&cfg, 5, &pre, &mut |_| {}).unwrap_err();
        assert!(err.contains("0/5"), "{err}");
    }

    /// 命令层全链(mock app + 真实 Channel):进度事件逐条推达,任务结束
    /// 令牌被清理,产物与 impl 路径逐值一致。
    #[test]
    fn run_command_streams_progress_and_cleans_registry() {
        let app = tauri::test::mock_app();
        app.manage(TaskRegistry::default());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::<ProgressEvent>::new(move |body| {
            match body {
                InvokeResponseBody::Json(s) => {
                    let ev: ProgressEvent = serde_json::from_str(&s).unwrap();
                    sink.lock().unwrap().push((ev.done, ev.total));
                }
                other => panic!("进度事件应为 JSON,得到 {other:?}"),
            }
            Ok(())
        });
        let out =
            tauri::async_runtime::block_on(run_simulation(YAML.into(), 3, channel, app.state()))
                .unwrap();
        assert_eq!(out["results"].as_array().unwrap().len(), 3);
        assert_eq!(*seen.lock().unwrap(), vec![(1, 3), (2, 3), (3, 3)]);
        assert!(
            app.state::<TaskRegistry>().take().is_none(),
            "任务结束须清理令牌"
        );
        // 与 impl 路径逐值一致(同配置同 seed)
        let plain = run_simulation_impl(YAML, 3, &fresh_flag(), &mut |_| {}).unwrap();
        assert_eq!(out["results"], plain["results"]);
        assert_eq!(out["days_csv"], plain["days_csv"]);
    }

    /// 取消命令语义:无活动任务为无操作(false);活动任务被置位(true)。
    #[test]
    fn cancel_run_hits_only_active_task() {
        let app = tauri::test::mock_app();
        app.manage(TaskRegistry::default());
        assert!(!cancel_run(app.state()));
        let flag = app.state::<TaskRegistry>().register();
        assert!(cancel_run(app.state()));
        assert!(flag.load(Ordering::Relaxed));
        assert!(app.state::<TaskRegistry>().take().is_some());
        assert!(!cancel_run(app.state()), "清理后再取消为无操作");
    }

    #[test]
    fn sweep_plan_candidate_recommend_match_core() {
        let plan = sweep_plan(EXP_YAML.into(), 0).unwrap();
        assert_eq!(plan["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(plan["sims"], 6);

        let values = r#"{"model.warrior.attack": 100.0}"#;
        let cand = sweep_candidate_impl(EXP_YAML, 2, values).unwrap();
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
        assert!(sweep_candidate_impl(EXP_YAML, 0, values).is_err());
        assert!(sweep_recommend("no sweep".into(), "[]".into()).is_err());
    }

    #[test]
    fn run_wasm_parity_same_config_seed() {
        // 三角口径(文档 18 章 Phase 7 验收):web_parity 已锁 wasm↔CLI
        // 逐值一致,本测试锁 desktop↔wasm——两条腿合起来,桌面与 CLI
        // 同配置同 seed 产物等价(同一内核的三个入口)。配置用宝可梦案例,
        // 与 web_parity 同源,覆盖 dungeon / progression 真实形状。
        let yaml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../examples/pokemon.yaml"
        ))
        .unwrap();
        let v = run_simulation_impl(&yaml, 2, &fresh_flag(), &mut |_| {}).unwrap();
        let w = sandtable_wasm::run_simulation_native(&yaml, 2).unwrap();
        assert_eq!(v["results"], w["results"], "results 逐值一致");
        assert_eq!(v["config_hash"], w["config_hash"], "config_hash 一致");
        assert_eq!(v["days_csv"], w["days_csv"], "days_csv 逐字节一致");
    }

    #[test]
    fn param_writeback_parity_wasm_native() {
        // WB-03.17 · 同一配置对照参数回写:数值读取全表(含 u64 无损通道)、
        // 应用回写(config_hash + 回读值)、KPI 可用性,桌面命令与 wasm
        // native 逐值一致;非法路径同通道显式拒绝,错误文案逐字一致。
        let yaml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../examples/pokemon.yaml"
        ))
        .unwrap();
        assert_eq!(
            param_values(yaml.clone()).unwrap(),
            sandtable_wasm::param_values_native(&yaml).unwrap(),
            "数值读取全表逐键一致",
        );
        let v = param_apply(yaml.clone(), "model.warrior.attack".into(), 250.0).unwrap();
        let w = sandtable_wasm::param_apply_native(&yaml, "model.warrior.attack", 250.0).unwrap();
        assert_eq!(v, w, "应用回写 config_hash 与回读值一致");
        let err_d = param_apply(yaml.clone(), "model.no_such".into(), 1.0).unwrap_err();
        let err_w = sandtable_wasm::param_apply_native(&yaml, "model.no_such", 1.0).unwrap_err();
        assert!(err_d.starts_with("配置错误"), "{err_d}");
        assert_eq!(err_d, err_w, "非法路径错误文案逐字一致");
        assert_eq!(
            kpi_availability(yaml.clone()).unwrap(),
            sandtable_wasm::kpi_availability_native(&yaml).unwrap(),
            "KPI 可用性同表",
        );
    }

    #[test]
    fn ab_stats_parity_wasm_native() {
        // WB-03.17 · 同一双臂对照 A/B 统计:同一内核 compare_arms,桌面命令
        // 与 wasm native 的 Comparison 逐字段一致(含 verdict / CI / 效应量);
        // 未知指标与种子错位的错误通道同构,文案逐字一致。
        let base = YAML.to_string();
        let cand = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_impl(base.as_str(), 4, &fresh_flag(), &mut |_| {}).unwrap();
        let b = run_simulation_impl(cand, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let results_a = a["results"].to_string();
        let results_b = b["results"].to_string();
        let d = ab_compare(
            base.clone(),
            cand.into(),
            "win_rate".into(),
            results_a.clone(),
            results_b.clone(),
        )
        .unwrap();
        let w = sandtable_wasm::ab_compare_native(&base, cand, "win_rate", &results_a, &results_b)
            .unwrap();
        assert_eq!(d, w, "A/B 统计 Comparison 逐字段一致");
        assert!(["BHigher", "AHigher", "NoDifference"].contains(&d["verdict"].as_str().unwrap()));
        assert_eq!(
            ab_compare(
                base.clone(),
                base.clone(),
                "winrate".into(),
                results_a.clone(),
                results_a.clone()
            )
            .unwrap_err(),
            sandtable_wasm::ab_compare_native(&base, &base, "winrate", &results_a, &results_a)
                .unwrap_err(),
            "未知指标错误文案逐字一致",
        );
        let other_seed = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let c = run_simulation_impl(other_seed, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let err_d = ab_compare(
            base.clone(),
            other_seed.into(),
            "win_rate".into(),
            results_a.clone(),
            c["results"].to_string(),
        )
        .unwrap_err();
        let err_w = sandtable_wasm::ab_compare_native(
            &base,
            other_seed,
            "win_rate",
            &results_a,
            &c["results"].to_string(),
        )
        .unwrap_err();
        assert!(err_d.contains("base_seed 不一致"), "{err_d}");
        assert_eq!(err_d, err_w, "种子错位错误文案逐字一致");
    }

    #[test]
    fn query_csv_view() {
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

    /// 与 CLI query 同源的 is_ident 守卫:非法词根(数字开头 + 空格)必须
    /// 在注册前被拦,报错含「非法」。
    #[test]
    fn query_rejects_illegal_view_name() {
        let dir = std::env::temp_dir().join(format!("st-desktop-query-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("9bad name.csv");
        std::fs::write(&f, "a\n1\n").unwrap();
        let err = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT * FROM t".into(),
        )
        .unwrap_err();
        assert!(err.contains("非法"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 合法词根 + 路径含单引号:DDL 字面量 `'`→`''` 翻倍必须兜住(与 CLI
    /// query_path_with_quote_still_queries 同口径,桌面侧独立锁死)。
    #[test]
    fn query_path_with_quote_still_queries() {
        let dir =
            std::env::temp_dir().join(format!("st-desktop-query-quote-{}", std::process::id()));
        let quoted = dir.join("it's out");
        std::fs::create_dir_all(&quoted).unwrap();
        let f = quoted.join("summary.csv");
        std::fs::write(&f, "a\n5\n6\n").unwrap();
        let v = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT count(*) AS n FROM summary".into(),
        )
        .unwrap();
        assert_eq!(v["rows"], serde_json::json!([["2"]]));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 下载落点:重名加序号,不静默覆盖上一次导出的产物(第 6 步下载接线)。
    #[test]
    fn download_destination_uniquifies() {
        let dir = std::env::temp_dir().join(format!("st-desktop-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(download_destination(&dir, "days.csv"), dir.join("days.csv"));
        std::fs::write(dir.join("days.csv"), "x").unwrap();
        assert_eq!(
            download_destination(&dir, "days.csv"),
            dir.join("days (1).csv")
        );
        std::fs::write(dir.join("days (1).csv"), "x").unwrap();
        assert_eq!(
            download_destination(&dir, "days.csv"),
            dir.join("days (2).csv")
        );
        // 无扩展名保持原样
        assert_eq!(download_destination(&dir, "report"), dir.join("report"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
