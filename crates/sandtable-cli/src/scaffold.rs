//! 脚手架:`sandtable scaffold <name>` 生成新场景/实验骨架(todo 脚手架条目,
//! 2026-10-27 拍板开工)。四件套 = 场景 yaml + 基线参数表 + 实验草稿 + README;
//! 模板集中在 `scaffold/templates/`(单一事实源,web「新建场景」向导未来经
//! wasm 绑定消费同一模板,不写两套)。
//!
//! 生成即自检:场景 yaml 经内核 `load_str` + `config::validate`,基线参数表
//! 由 `params::export_csv` 从同一场景导出——模板失效会在生成时立即暴露,
//! 不会产出跑不起来的骨架。

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context};

use sandtable_core as core;

use crate::params;

const SCENARIO_TEMPLATE: &str = include_str!("scaffold/templates/scenario.yaml");
const EXPERIMENT_TEMPLATE: &str = include_str!("scaffold/templates/experiment.yaml");
const README_TEMPLATE: &str = include_str!("scaffold/templates/README.md");

/// 场景名白名单:字母开头,字母/数字/`-`/`_`,长度 ≤ 64。
/// 白名单而非黑名单:拒绝路径分隔符、`..`、点号等任何可疑字符。
pub fn is_valid_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 64 {
        return false;
    }
    let mut chars = name.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphabetic() {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// 生成四件套到 `<out>/<name>/`,返回写入的文件路径(含 params.csv)。
pub fn generate(out: &Path, name: &str) -> anyhow::Result<Vec<PathBuf>> {
    if !is_valid_name(name) {
        bail!("场景名 `{name}` 非法:字母开头,仅字母/数字/`-`/`_`,长度 ≤ 64");
    }
    let dir = out.join(name);
    if dir.exists() {
        bail!("{} 已存在,不覆盖", dir.display());
    }
    fs::create_dir_all(&dir).with_context(|| format!("创建 {} 失败", dir.display()))?;

    let scenario = SCENARIO_TEMPLATE.replace("__NAME__", name);
    let experiment = EXPERIMENT_TEMPLATE.replace("__NAME__", name);
    let readme = README_TEMPLATE.replace("__NAME__", name);

    let scenario_path = dir.join("scenario.yaml");
    let experiment_path = dir.join("experiment.yaml");
    let readme_path = dir.join("README.md");
    fs::write(&scenario_path, &scenario)
        .with_context(|| format!("写 {} 失败", scenario_path.display()))?;
    fs::write(&experiment_path, &experiment)
        .with_context(|| format!("写 {} 失败", experiment_path.display()))?;
    fs::write(&readme_path, &readme)
        .with_context(|| format!("写 {} 失败", readme_path.display()))?;

    // 生成即自检 + 基线参数表:场景须过内核校验,否则模板已失效。
    let cfg = core::scenario::load_str(&scenario)
        .context("脚手架场景模板未通过内核加载(模板失效,请修 templates/)")?;
    core::config::validate(&cfg).context("脚手架场景模板未通过内核校验")?;
    let params_path = dir.join("params.csv");
    fs::write(&params_path, params::export_csv(&cfg))
        .with_context(|| format!("写 {} 失败", params_path.display()))?;

    Ok(vec![
        scenario_path,
        params_path,
        experiment_path,
        readme_path,
    ])
}
