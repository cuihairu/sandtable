//! simulate 参数面:replicates 下限与 MCP / wasm 同口径(退出码 2)。
//! `--replicates 0` 此前未拦:空 Vec 后 `results[0]` 越界 panic
//! (2026-11-12 审核修复批 P1)。

use std::process::Command;

#[test]
fn simulate_rejects_zero_replicates() {
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(["simulate", "--replicates", "0"])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("replicates 至少为 1"), "{stderr}");
}
