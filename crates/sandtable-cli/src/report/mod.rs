//! HTML 报告(Phase 5,文档 9/10 章):读已落盘产物 → 单文件自包含 HTML。
//!
//! 纪律:
//! - 只读文件,不重新仿真(与 `query` 同一条:产物 → 报告,仿真路径之外);
//! - 发现什么渲染什么,缺失的板块跳过,页首列出实际读取的源;
//! - 输出内联 CSS + 手写内联 SVG,无 CDN、无 JS,离线双击可开;
//! - 一个源文件都找不到则报错(调用方走退出码 2)。

use std::path::PathBuf;

use anyhow::bail;

mod data;
mod html;
mod svg;

pub(crate) use data::*;
pub(crate) use html::*;

/// 渲染报告。输入是目录(发现约定文件)或直接给的产物文件。
pub fn render(inputs: &[PathBuf]) -> anyhow::Result<String> {
    let mut src = Sources::default();
    for input in inputs {
        if input.is_dir() {
            for name in KNOWN {
                let p = input.join(name);
                if p.is_file() {
                    load(&mut src, &p)?;
                }
            }
        } else if input.is_file() {
            load(&mut src, input)?;
        } else {
            bail!("{} 不存在", input.display());
        }
    }
    if src.is_empty() {
        bail!("给定路径中没有报告源(可识别:{})", KNOWN.join(" / "));
    }
    Ok(page(&src))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// I-026 · HTML 分群画像与 report.json 一致性:某 replicate 缺该分群时
    /// (索引错位/空群被省),均值除数必须跟实际匹配条目数——旧代码除以
    /// results.len(),缺席把均值稀释一半;均值聚合走内核 summarize,
    /// 流失率为合并口径(churned 合计 / count 合计)。
    #[test]
    fn population_means_divide_by_matched_entries() {
        let report = json!({
            "results": [
                {
                    "config_hash": "aaaaaaaa1111",
                    "cohort_stats": [
                        {"cohort": "casual", "count": 80, "churned": 8,
                         "mean_level": 2.0, "mean_power": 100.0, "mean_gold": 10.0},
                        {"cohort": "core", "count": 20, "churned": 2,
                         "mean_level": 5.0, "mean_power": 200.0, "mean_gold": 40.0}
                    ]
                },
                {
                    "config_hash": "aaaaaaaa1111",
                    "cohort_stats": [
                        {"cohort": "casual", "count": 80, "churned": 16,
                         "mean_level": 4.0, "mean_power": 140.0, "mean_gold": 30.0}
                    ]
                }
            ]
        });
        let mut src = Sources::default();
        src.push_json("report.json", report);
        let mut body = String::new();
        section_population(&mut body, &src);
        // casual:两 replicate 齐,均值 = (2+4)/2 等;流失率合并 24/160 = 15%
        assert!(body.contains(
            "<tr><td>casual</td><td>80</td><td>15.00%</td><td>3.0000</td><td>120.00</td><td>20.0000</td></tr>"
        ));
        // core:仅 1 replicate 有,均值不得被 n=2 稀释(旧代码得 2.5000/100.00/20.0000)
        assert!(body.contains(
            "<tr><td>core</td><td>20</td><td>10.00%</td><td>5.0000</td><td>200.00</td><td>40.0000</td></tr>"
        ));
    }
}
