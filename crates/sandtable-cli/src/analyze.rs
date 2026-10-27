//! 分析脚本执行面(todo「数据分析面」step ②,2026-10-27)。
//!
//! 口径(scripts/scripting-design.md §5,安全权威):CPython 无真沙箱,
//! 安全只能靠**进程隔离与执行策略**,不靠语言层。本子命令是 §5 表
//! 「本地作者跑自己写的脚本(可信默认)」的显式执行面,三条策略:
//! - 执行前打印脚本路径与内容哈希(SHA-256),留执行留痕;
//! - `--data` 申明的数据路径按只读输入对待:执行前后各做一次内容清单,
//!   结束后不一致即失败退出——只读是「检测 + 失败」口径(本机无特权做
//!   真只读挂载,不冒充语言级防写);
//! - 超时(缺省 600s)杀整个进程组(退出码 124,同 GNU timeout 惯例),
//!   不留孤儿进程。
//!
//! 红线(§5):本项目不做「运行他人脚本」的托管服务;服务端/多租户场景
//! 用户自建容器隔离。脚本解释器是外部进程(缺省 python3),CLI 二进制
//! 不内嵌 CPython(§2 方案 C 已否决)。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{bail, Context};

use crate::project::sha256_hex;

/// 超时退出码(GNU timeout 惯例)。
pub const EXIT_TIMEOUT: i32 = 124;

/// 递归收集数据路径的内容清单:绝对路径 → SHA-256。
/// 只收常规文件;符号链接一律跳过(链接目标可能越出申明路径,不追)。
fn collect_manifest(data: &[PathBuf]) -> anyhow::Result<BTreeMap<PathBuf, String>> {
    let mut manifest = BTreeMap::new();
    for root in data {
        let root = root
            .canonicalize()
            .with_context(|| format!("只读数据路径不存在: {}", root.display()))?;
        collect_one(&root, &mut manifest)?;
    }
    Ok(manifest)
}

fn collect_one(path: &Path, manifest: &mut BTreeMap<PathBuf, String>) -> anyhow::Result<()> {
    let meta = std::fs::metadata(path).with_context(|| format!("读取 {} 失败", path.display()))?;
    if meta.is_file() {
        let bytes = std::fs::read(path).with_context(|| format!("读取 {} 失败", path.display()))?;
        manifest.insert(path.to_path_buf(), sha256_hex(&bytes));
        return Ok(());
    }
    if !meta.is_dir() {
        bail!("只读数据路径既非文件也非目录: {}", path.display());
    }
    let mut entries: Vec<_> = std::fs::read_dir(path)
        .with_context(|| format!("遍历 {} 失败", path.display()))?
        .collect::<Result<_, _>>()
        .with_context(|| format!("遍历 {} 失败", path.display()))?;
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        // 符号链接跳过:目标可能在申明路径之外,不追、不哈希
        if e.file_type()
            .with_context(|| format!("读取 {} 类型失败", e.path().display()))?
            .is_symlink()
        {
            continue;
        }
        collect_one(&e.path(), manifest)?;
    }
    Ok(())
}

fn find_python() -> anyhow::Result<PathBuf> {
    for cand in ["python3", "python"] {
        if Command::new(cand).arg("--version").output().is_ok() {
            return Ok(PathBuf::from(cand));
        }
    }
    bail!("未找到 python3 / python 解释器,请用 --python 指定")
}

#[cfg(unix)]
fn spawn_in_group(command: &mut Command) -> std::io::Result<std::process::Child> {
    use std::os::unix::process::CommandExt;
    // 独立进程组:超时 kill 整组,不留 python 子进程孤儿
    command.process_group(0);
    command.spawn()
}

#[cfg(windows)]
fn spawn_in_group(command: &mut Command) -> std::io::Result<std::process::Child> {
    command.spawn()
}

#[cfg(unix)]
fn kill_group(child: &mut std::process::Child) {
    // 负 pid = 杀整个进程组;SIGKILL 不依赖进程配合
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn kill_group(child: &mut std::process::Child) {
    let _ = child.kill();
}

/// 执行分析脚本,返回子进程退出码(超时返回 [`EXIT_TIMEOUT`])。
pub fn run(
    script: &Path,
    data: &[PathBuf],
    timeout_secs: u64,
    python: Option<&Path>,
    script_args: &[String],
) -> anyhow::Result<i32> {
    if !script.is_file() {
        bail!("分析脚本不存在: {}", script.display());
    }
    let bytes = std::fs::read(script).with_context(|| format!("读 {} 失败", script.display()))?;

    // 执行策略头(§5 规则②):路径 + 内容哈希先落 stdout,再动手
    println!("分析脚本: {}", script.display());
    println!("内容哈希(SHA-256): {}", sha256_hex(&bytes));
    for p in data {
        println!("只读数据路径: {}", p.display());
    }

    let before = collect_manifest(data)?;

    let interp = match python {
        Some(p) => p.to_path_buf(),
        None => find_python()?,
    };
    println!("解释器: {}", interp.display());
    println!("超时: {timeout_secs}s");
    println!("---");

    let mut cmd = Command::new(&interp);
    cmd.arg(script).args(script_args);
    cmd.env("SANDTABLE_ANALYZE_SCRIPT", script);
    if !data.is_empty() {
        // join_paths 按平台分隔符拼接并转义,脚本侧用对应 API 拆分
        cmd.env("SANDTABLE_ANALYZE_DATA", std::env::join_paths(data)?);
    }
    cmd.env("SANDTABLE_ANALYZE_TIMEOUT", timeout_secs.to_string());
    cmd.stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    let mut child =
        spawn_in_group(&mut cmd).with_context(|| format!("启动 {} 失败", interp.display()))?;

    let deadline = Instant::now() + Duration::from_secs(timeout_secs);
    let status = loop {
        match child.try_wait().context("等待子进程失败")? {
            Some(s) => break s,
            None => {
                if Instant::now() >= deadline {
                    kill_group(&mut child);
                    let _ = child.wait();
                    eprintln!("分析脚本超时({timeout_secs}s),已终止进程组");
                    return Ok(EXIT_TIMEOUT);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    };

    // 只读口径:执行后清单必须与执行前逐文件一致(内容/新增/删除)
    let after = collect_manifest(data)?;
    if before != after {
        let mut diffs: Vec<String> = Vec::new();
        for (k, v) in &before {
            match after.get(k) {
                None => diffs.push(format!("  删除 {}", k.display())),
                Some(a) if a != v => diffs.push(format!("  修改 {}", k.display())),
                Some(_) => {}
            }
        }
        for k in after.keys() {
            if !before.contains_key(k) {
                diffs.push(format!("  新增 {}", k.display()));
            }
        }
        bail!(
            "只读数据路径在执行中被改动(违反 analyze 只读口径):\n{}",
            diffs.join("\n")
        );
    }

    Ok(status.code().unwrap_or(1))
}
