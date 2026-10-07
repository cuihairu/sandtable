//! Arrow RecordBatch 构建(文档 09 章:数据契约)。
//!
//! CSV / JSON 的列名、列序、类型自 MVP 起就按"可直接映射为 Arrow
//! RecordBatch"设计;本模块把同一份 [`RunMetrics`] 映射为三个批次:
//! `day_stats` / `power_snapshots` / `cohort`,列与 [`super::day_csv`]
//! 的表头一一对应——**换包装,不改语义**,已有消费者不破坏。
//!
//! core 只产出 RecordBatch,不做文件 I/O(平台边界,文档 04 章);
//! Parquet 载体在 CLI(`sandtable-cli` 的 `parquet` feature)。

use std::sync::Arc;

use arrow::array::{
    ArrayRef, Float64Array, Int64Array, RecordBatch, StringArray, UInt32Array, UInt64Array,
};
use arrow::datatypes::{DataType, Field, Schema};
use arrow::error::ArrowError;

use crate::metrics::RunMetrics;

pub type ArrowResult<T> = Result<T, ArrowError>;

/// 从 (列名, 类型) 表构建全非空 Schema。
fn schema_of(fields: &[(&str, DataType)]) -> Arc<Schema> {
    Arc::new(Schema::new(
        fields
            .iter()
            .map(|(name, ty)| Field::new(*name, ty.clone(), false))
            .collect::<Vec<_>>(),
    ))
}

/// 日序列批次(列名 / 列序 / 类型与 [`super::day_csv`] 表头一致)。
pub fn day_stats_batch(m: &RunMetrics) -> ArrowResult<RecordBatch> {
    let schema = schema_of(&[
        ("day", DataType::UInt32),
        ("active", DataType::UInt64),
        ("alive_at_start", DataType::UInt64),
        ("new_churned", DataType::UInt64),
        ("churn_rate", DataType::Float64),
        ("battles", DataType::UInt64),
        ("wins", DataType::UInt64),
        ("win_rate", DataType::Float64),
        ("gold_earned", DataType::UInt64),
        ("gold_spent", DataType::UInt64),
        ("sink_ratio", DataType::Float64),
        ("gold_supply", DataType::Int64),
        ("inflation", DataType::Float64),
        ("income_per_active", DataType::Float64),
        ("spending_per_active", DataType::Float64),
        ("mean_power", DataType::Float64),
        ("levelups", DataType::UInt64),
        ("upgrades", DataType::UInt64),
    ]);
    let cols: Vec<ArrayRef> = vec![
        Arc::new(UInt32Array::from_iter_values(
            m.day_stats.iter().map(|d| d.day),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.active),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.alive_at_start),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.new_churned),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.churn_rate),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.battles),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.wins),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.win_rate),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.gold_earned),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.gold_spent),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.sink_ratio),
        )),
        Arc::new(Int64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.gold_supply),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.inflation),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.income_per_active),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.spending_per_active),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.mean_power),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.levelups),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.day_stats.iter().map(|d| d.upgrades),
        )),
    ];
    RecordBatch::try_new(schema, cols)
}

/// 快照日 Power 分布批次。
pub fn power_snapshots_batch(m: &RunMetrics) -> ArrowResult<RecordBatch> {
    let schema = schema_of(&[
        ("day", DataType::UInt32),
        ("n", DataType::UInt64),
        ("p50", DataType::Float64),
        ("p90", DataType::Float64),
        ("p99", DataType::Float64),
    ]);
    let cols: Vec<ArrayRef> = vec![
        Arc::new(UInt32Array::from_iter_values(
            m.power_snapshots.iter().map(|s| s.day),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.power_snapshots.iter().map(|s| s.n),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.power_snapshots.iter().map(|s| s.p50),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.power_snapshots.iter().map(|s| s.p90),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.power_snapshots.iter().map(|s| s.p99),
        )),
    ];
    RecordBatch::try_new(schema, cols)
}

/// 期末 cohort 切片批次。
pub fn cohort_batch(m: &RunMetrics) -> ArrowResult<RecordBatch> {
    let schema = schema_of(&[
        ("cohort", DataType::Utf8),
        ("count", DataType::UInt64),
        ("churned", DataType::UInt64),
        ("mean_power", DataType::Float64),
        ("mean_gold", DataType::Float64),
        ("mean_level", DataType::Float64),
    ]);
    let cols: Vec<ArrayRef> = vec![
        Arc::new(StringArray::from_iter_values(
            m.cohort_stats.iter().map(|c| c.cohort),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.cohort_stats.iter().map(|c| c.count),
        )),
        Arc::new(UInt64Array::from_iter_values(
            m.cohort_stats.iter().map(|c| c.churned),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.cohort_stats.iter().map(|c| c.mean_power),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.cohort_stats.iter().map(|c| c.mean_gold),
        )),
        Arc::new(Float64Array::from_iter_values(
            m.cohort_stats.iter().map(|c| c.mean_level),
        )),
    ];
    RecordBatch::try_new(schema, cols)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SimConfig;

    fn small_run() -> RunMetrics {
        let cfg = SimConfig {
            players: 20,
            days: 4,
            ..SimConfig::default()
        };
        crate::sim::run(&cfg, 0)
    }

    /// 数据契约(文档 09 章):Arrow 批次的列名与列序必须与 CSV 表头一致。
    #[test]
    fn arrow_日序列列名与csv契约一致() {
        let m = small_run();
        let batch = day_stats_batch(&m).unwrap();
        let schema = batch.schema();
        let arrow_names: Vec<&str> = schema.fields().iter().map(|f| f.name().as_str()).collect();
        let csv = super::super::day_csv(&m);
        let csv_header = csv.lines().next().unwrap();
        let csv_names: Vec<&str> = csv_header.split(',').collect();
        assert_eq!(arrow_names, csv_names);
    }

    #[test]
    fn arrow_日序列行数与数值对应() {
        let m = small_run();
        let batch = day_stats_batch(&m).unwrap();
        assert_eq!(batch.num_rows(), m.day_stats.len());

        let day = batch
            .column(0)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap();
        for (i, d) in m.day_stats.iter().enumerate() {
            assert_eq!(day.value(i), d.day);
        }
        let gold = batch
            .column(8)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();
        for (i, d) in m.day_stats.iter().enumerate() {
            assert_eq!(gold.value(i), d.gold_earned);
        }
        let supply = batch
            .column(11)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        assert_eq!(supply.value(0), m.day_stats[0].gold_supply);
    }

    #[test]
    fn arrow_快照与cohort批次行数() {
        let m = small_run();
        let ps = power_snapshots_batch(&m).unwrap();
        assert_eq!(ps.num_rows(), m.power_snapshots.len());
        let cohort = cohort_batch(&m).unwrap();
        assert_eq!(cohort.num_rows(), m.cohort_stats.len());
        let names = cohort
            .column(0)
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        for (i, c) in m.cohort_stats.iter().enumerate() {
            assert_eq!(names.value(i), c.cohort);
        }
        // 列契约:类型与可空性
        assert_eq!(ps.schema().field(0).data_type(), &DataType::UInt32);
        assert!(!cohort.schema().field(0).is_nullable());
    }
}
