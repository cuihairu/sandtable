//! Parquet 载体回读测试(feature `parquet`,文档 09 章数据契约):
//! 写出的三个批次可被 Parquet reader 原样读回——换包装,不改语义。

#![cfg(feature = "parquet")]

use std::fs;

use arrow::array::RecordBatch;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ArrowWriter;

use sandtable_core as core;

fn run_small() -> core::metrics::RunMetrics {
    let cfg = core::config::SimConfig {
        players: 30,
        days: 5,
        ..core::config::SimConfig::default()
    };
    core::sim::run(&cfg, 0)
}

#[test]
fn parquet_写出后原样读回() {
    let m = run_small();
    let dir = std::env::temp_dir().join(format!("sandtable-parquet-test-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();

    for (name, batch) in [
        (
            "day_stats",
            core::export::arrow::day_stats_batch(&m).unwrap(),
        ),
        (
            "power_snapshots",
            core::export::arrow::power_snapshots_batch(&m).unwrap(),
        ),
        ("cohort", core::export::arrow::cohort_batch(&m).unwrap()),
    ] {
        let path = dir.join(format!("{name}.parquet"));
        let file = fs::File::create(&path).unwrap();
        let mut w = ArrowWriter::try_new(file, batch.schema(), None).unwrap();
        w.write(&batch).unwrap();
        w.close().unwrap();

        let file = fs::File::open(&path).unwrap();
        let reader = ParquetRecordBatchReaderBuilder::try_new(file)
            .unwrap()
            .build()
            .unwrap();
        let batches: Vec<RecordBatch> = reader.map(|b| b.unwrap()).collect();
        assert_eq!(batches.len(), 1, "{name}");
        assert_eq!(batches[0], batch, "{name} 回读不一致");
    }

    fs::remove_dir_all(&dir).ok();
}
