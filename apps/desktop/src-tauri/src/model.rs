//! 配置与指标命令域(桌面壳):加载 / 校验 / 参数读写 / KPI 编译求值 /
//! A/B 对照 / 每日聚合 / 指标字典。

/// 加载 + 校验(错误前缀与 wasm 绑定同源,前端处理一致)。
pub(crate) fn load(yaml: &str) -> Result<sandtable_core::config::SimConfig, String> {
    let cfg = sandtable_core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    sandtable_core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

/// 校验配置:`{config_hash, players, days, schema_version, model_version}`;
/// 与 wasm validate_config 逐字段同构。
#[tauri::command]
pub(crate) fn validate_config(yaml: String) -> Result<serde_json::Value, String> {
    // 校验通道接受实验 YAML(sweep / optimize 节摘出),与 wasm
    // validate_config 同口径;执行入口(run 等)仍走 load 只收场景 YAML。
    let cfg =
        sandtable_core::scenario::load_config_str(&yaml).map_err(|e| format!("配置错误: {e}"))?;
    sandtable_core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
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
pub(crate) fn param_registry() -> serde_json::Value {
    serde_json::json!(sandtable_core::registry::all().cloned().collect::<Vec<_>>())
}

/// 当前配置数值读取:{path: 当前生效值}(WB-03.05),与 wasm param_values
/// 同构——数值槽逐路径 read_numeric;非数值槽缺键 ≠ 0;loot/gacha 未配置
/// 返回内核真实生效缺省,不拿注册表 default 补值。u64 槽位走无损通道
/// (WB-03.08):≤ 2^53−1 是 JSON 数字,超出 JS 安全整数以十进制字符串
/// 无损表达,不静默舍入。
#[tauri::command]
pub(crate) fn param_values(yaml: String) -> Result<serde_json::Value, String> {
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
pub(crate) fn param_apply(
    yaml: String,
    path: String,
    value: f64,
) -> Result<serde_json::Value, String> {
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
pub(crate) fn kpi_availability(yaml: String) -> Result<serde_json::Value, String> {
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
pub(crate) fn ab_compare(
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
pub(crate) fn daily_aggregate(results_json: String) -> Result<serde_json::Value, String> {
    let results: Vec<sandtable_core::metrics::RunMetrics> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 逐日聚合结果解析失败: {e}"))?;
    let aggregation = sandtable_core::experiment::daily_aggregate_metrics(&results)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(aggregation).map_err(|e| format!("配置错误: {e}"))
}

/// 自定义 KPI 校验(桌面命令):表达式过内核公式白名单并拒绝常量表达式,
/// 只编译不碰运行期数据;core 直连,与 wasm `kpi_validate` 同构。
#[tauri::command]
pub(crate) fn kpi_validate(expression: String) -> Result<serde_json::Value, String> {
    let shape = sandtable_core::kpi_custom::validate_expression(&expression)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(shape).map_err(|e| format!("序列化失败: {e}"))
}

/// 自定义 KPI 求值(桌面命令):表达式逐 replicate 求值 + 跨 replicate 聚合,
/// core 直连,与 wasm `kpi_eval` 同构(n < 2 不给统计区间,缺席指标不填 0)。
#[tauri::command]
pub(crate) fn kpi_eval(
    expression: String,
    results_json: String,
) -> Result<serde_json::Value, String> {
    let results: Vec<sandtable_core::metrics::RunMetrics> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 逐 replicate 结果解析失败: {e}"))?;
    let out = sandtable_core::kpi_custom::evaluate(&expression, &results)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(out).map_err(|e| format!("序列化失败: {e}"))
}

/// 指标字典(桌面命令):core 直连,与 wasm `metric_dictionary` 同构。
/// 机器可判定口径事实源(量纲 / 小数位 / 可空 / 可用性门槛),
/// 显示名在前端 locale 层。
#[tauri::command]
pub(crate) fn metric_dictionary() -> Result<serde_json::Value, String> {
    serde_json::to_value(serde_json::json!({
        "dict_version": sandtable_core::kpi_dict::METRIC_DICT_VERSION,
        "metrics": sandtable_core::kpi_dict::metric_definitions(),
    }))
    .map_err(|e| format!("序列化失败: {e}"))
}
