//! `sandtable analyze` 端到端:脚本执行面(scripting-design.md §5 口径)。
//! 四径:正常执行(打印哈希/数据路径 + 转发参数与 env)、真实
//! pandas + DuckDB + sandtable_sim 绑定通道、只读数据路径被改动即失败、
//! 超时杀进程组退出码 124。本机无解释器时跳过(不硬失败)。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-analyze-{tag}-{}-{nanos}", std::process::id()))
}

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

/// 找一个可用的解释器;都没有就返回 None(测试跳过)。
fn python() -> Option<&'static str> {
    ["python3", "python"]
        .into_iter()
        .find(|cand| Command::new(cand).arg("--version").output().is_ok())
}

fn python_has_module(cand: &str, module: &str) -> bool {
    Command::new(cand)
        .args(["-c", &format!("import {module}")])
        .output()
        .is_ok_and(|out| out.status.success())
}

fn write(dir: &Path, name: &str, content: &str) -> PathBuf {
    let p = dir.join(name);
    fs::write(&p, content).unwrap();
    p
}

#[test]
fn analyze_runs_and_prints_policy_header() {
    let Some(py) = python() else {
        eprintln!("跳过:无 python 解释器");
        return;
    };
    let dir = temp_dir("run");
    fs::create_dir_all(&dir).unwrap();

    let data = write(&dir, "data.csv", "hello\n");
    let script = write(
        &dir,
        "script.py",
        "import sys, os\n\
         print('ARG=' + sys.argv[1])\n\
         print('DATA=' + os.environ.get('SANDTABLE_ANALYZE_DATA', ''))\n\
         with open(sys.argv[1], 'w') as f:\n    f.write('done')\n",
    );
    let outfile = dir.join("out.txt");

    let out = bin(&[
        "analyze",
        script.to_str().unwrap(),
        "--data",
        data.to_str().unwrap(),
        "--python",
        py,
        "--timeout",
        "30",
        "--",
        outfile.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("内容哈希(SHA-256):"), "应打印脚本哈希");
    assert!(stdout.contains("只读数据路径:"), "应打印数据路径");
    assert!(stdout.contains("ARG="), "参数应转发");
    assert!(stdout.contains("DATA="), "数据路径 env 应注入");
    assert_eq!(fs::read_to_string(&outfile).unwrap(), "done");
}

#[test]
fn analyze_runs_python_bindings_with_pandas_and_duckdb() {
    // 本机可能缺 pandas / duckdb / sandtable_sim(pyo3 wheel);缺件即跳过,
    // 不把「绑定通道未安装」当作失败(同 python() 缺解释器跳过的先例)。
    let modules = ["pandas", "duckdb", "sandtable_sim"];
    let Some(py) = ["python3", "python", "/usr/bin/python3"]
        .into_iter()
        .find(|cand| modules.iter().all(|m| python_has_module(cand, m)))
    else {
        eprintln!("跳过:无 pandas / duckdb / sandtable_sim 解释器");
        return;
    };
    let dir = temp_dir("python");
    fs::create_dir_all(&dir).unwrap();

    let data = write(&dir, "data.csv", "value\n1.5\n2.5\n");
    let scenario = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");
    let script = write(
        &dir,
        "analysis.py",
        &format!(
            r#"import os
import duckdb
import pandas as pd
import sandtable_sim as st

data = os.environ["SANDTABLE_ANALYZE_DATA"].split(os.pathsep)[0]
frame = pd.read_csv(data)
total = duckdb.sql(
    "SELECT sum(value) AS value FROM read_csv_auto('" + data + "')"
).limit(1).fetchall()[0][0]
output = st.run(st.load({scenario:?}), replicates=1)
print(f"ROWS={{len(frame)}} SUM={{total:g}} DAYS={{len(output['days_csv'].splitlines()) - 1}}")"#
        ),
    );

    let out = bin(&[
        "analyze",
        script.to_str().unwrap(),
        "--data",
        data.to_str().unwrap(),
        "--python",
        py,
        "--timeout",
        "60",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("ROWS=2"), "{stdout}");
    assert!(stdout.contains("SUM=4"), "{stdout}");
    assert!(stdout.contains("DAYS=30"), "{stdout}");
}

#[test]
fn analyze_rejects_data_modification() {
    let Some(py) = python() else {
        eprintln!("跳过:无 python 解释器");
        return;
    };
    let dir = temp_dir("ro");
    fs::create_dir_all(&dir).unwrap();

    let data = write(&dir, "data.csv", "original\n");
    let script = write(
        &dir,
        "write.py",
        "import sys\nwith open(sys.argv[1], 'w') as f:\n    f.write('mutated')\n",
    );

    let out = bin(&[
        "analyze",
        script.to_str().unwrap(),
        "--data",
        data.to_str().unwrap(),
        "--python",
        py,
        "--timeout",
        "30",
        "--",
        data.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("只读数据路径在执行中被改动"), "{stderr}");
}

#[test]
fn analyze_timeout_kills_process_group() {
    let Some(py) = python() else {
        eprintln!("跳过:无 python 解释器");
        return;
    };
    let dir = temp_dir("timeout");
    fs::create_dir_all(&dir).unwrap();

    let script = write(&dir, "sleep.py", "import time\ntime.sleep(60)\n");
    let start = std::time::Instant::now();
    let out = bin(&[
        "analyze",
        script.to_str().unwrap(),
        "--python",
        py,
        "--timeout",
        "1",
    ]);
    let elapsed = start.elapsed();
    assert_eq!(out.status.code(), Some(124), "超时应退出码 124");
    assert!(
        elapsed < std::time::Duration::from_secs(10),
        "超时处理应迅速返回(实际 {elapsed:?})"
    );
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("超时"),
        "应打印超时说明"
    );
}
