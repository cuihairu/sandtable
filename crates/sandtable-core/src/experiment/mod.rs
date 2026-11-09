//! 实验统计(文档 11/13/15 章)。
//!
//! 统计单位是 replicate:R 个 replicate 各产出一个指标值 m_r,对 {m_r}
//! 做 mean / sd / CI₉₅ = mean ± t(0.975, R−1) · sd / √R。t 临界值用硬编码
//! 表(df 1..=30),df > 30 退化为正态近似 1.96——足够的 replicates 下
//! 误差远小于样本噪声。
//!
//! A/B 比较:两臂同 replicate 用同一种子(CRN 配对),主报告配对差值的
//! 置信区间与配对效应量 d_z = Δ / s_d(分子分母同源于配对差序列)。

mod arms;
mod daily;
mod metric;
mod stats;

pub use arms::compare_arms;
pub use daily::{
    daily_aggregate_metrics, AggregateMetricStats, DailyAggregatedDay, DailyAggregation,
    DAILY_CI_METHOD, DAILY_SD_METHOD,
};
pub use metric::MetricKey;
pub use stats::{compare, summarize, t_critical_975, Comparison, SampleStats, Verdict};

#[cfg(test)]
mod tests;
