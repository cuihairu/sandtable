//! A/B 双臂 CRN 成对比较入口:双臂配置 + 双臂已跑结果进内核,结论由
//! [`compare`] 直出;成对前提全部显式失败不静默降级。
use super::metric::MetricKey;
use super::stats::{compare, Comparison};

/// A/B 双臂 CRN 成对比较入口(WB-03.10):双臂配置 + 双臂**已跑**结果数组
/// 进内核,结论由 [`compare`] 直出——桥接层(wasm / 桌面)只做 YAML →
/// SimConfig 与 results JSON → RunMetrics 反序列化,统计判定全部在内核,
/// 前端不另算。
///
/// 成对前提全部在这里显式失败,不静默降级:
/// - 双臂 base_seed 必须一致(CRN 按 replicate 序号配对,种子错位则
///   成对差值无意义);
/// - 指标在任一臂不可用(天数不足 / gacha / loot 未配置,
///   [`MetricKey::unavailable_reason`])直接报错,不做单臂跳过;
/// - 双臂 replicate 数等长非零;
/// - 某 replicate 的 [`MetricKey::extract`] 为 None(该臂此指标不产数)
///   报错,不 0 填充(WB-03.02 空值语义)。
pub fn compare_arms(
    cfg_a: &crate::config::SimConfig,
    cfg_b: &crate::config::SimConfig,
    key: MetricKey,
    arm_a: &[crate::metrics::RunMetrics],
    arm_b: &[crate::metrics::RunMetrics],
) -> crate::Result<Comparison> {
    if cfg_a.base_seed != cfg_b.base_seed {
        return Err(crate::Error::Config(format!(
            "双臂 base_seed 不一致(base={} cand={}),CRN 成对比较要求同种子",
            cfg_a.base_seed, cfg_b.base_seed
        )));
    }
    let name = key.name();
    if let Some(reason) = key.unavailable_reason(cfg_a) {
        return Err(crate::Error::Config(format!(
            "指标 {name} 在 base 臂不可用:{reason}"
        )));
    }
    if let Some(reason) = key.unavailable_reason(cfg_b) {
        return Err(crate::Error::Config(format!(
            "指标 {name} 在 cand 臂不可用:{reason}"
        )));
    }
    if arm_a.is_empty() || arm_a.len() != arm_b.len() {
        return Err(crate::Error::Config(format!(
            "双臂 replicate 数不一致或为 0(base={} cand={}),CRN 成对要求等长非零",
            arm_a.len(),
            arm_b.len()
        )));
    }
    let extract_all = |arm: &[crate::metrics::RunMetrics]| -> crate::Result<Vec<f64>> {
        arm.iter()
            .enumerate()
            .map(|(i, m)| {
                key.extract(m).ok_or_else(|| {
                    crate::Error::Config(format!(
                        "指标 {name} 在 replicate {i} 不可用(extract None),\
                             不用 0 填充;检查该臂的快照日/系统配置"
                    ))
                })
            })
            .collect()
    };
    let vals_a = extract_all(arm_a)?;
    let vals_b = extract_all(arm_b)?;
    Ok(compare(name, &vals_a, &vals_b))
}
