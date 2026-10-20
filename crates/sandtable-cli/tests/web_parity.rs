//! Web 等价验收(文档 18 章 Phase 6):同一配置同一 seed,wasm 绑定
//! `run_simulation_native` 的 results 与 CLI `simulate` 的 report.json
//! 逐值一致——浏览器与 CLI 是同一内核的两个入口。

use std::fs;
use std::path::PathBuf;
use std::process::Command;

/// 每个测试独占的临时目录(不共享,并行测试互不覆盖)。
fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// 两个 JSON 值是否同:数值走相对容差(挡 serde 往返噪声),其余逐位相等。
fn same(a: &serde_json::Value, b: &serde_json::Value, what: &str) {
    match (a, b) {
        (serde_json::Value::Number(x), serde_json::Value::Number(y)) => {
            let (ax, ay) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            assert!(
                (ax - ay).abs() <= 1e-9 * (1.0 + ax.abs().max(ay.abs())),
                "{what}: {ax} != {ay}"
            );
        }
        _ => assert_eq!(a, b, "{what}"),
    }
}

#[test]
fn web_binding_matches_cli_values() {
    let dir = scratch("st-parity");

    // 用宝可梦案例配置(非默认值,覆盖 dungeon/progression 真实形状)
    let yaml = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");

    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "simulate",
            yaml,
            "--replicates",
            "2",
            "--out",
            dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let cli: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("report.json")).unwrap()).unwrap();
    let web = sandtable_wasm::run_simulation_native(&fs::read_to_string(yaml).unwrap(), 2).unwrap();

    assert_eq!(cli["results"], web["results"], "results 逐值一致");
    assert_eq!(
        cli["results"][0]["config_hash"], web["config_hash"],
        "config_hash 一致"
    );

    // 文档 09 章契约:绑定输出附带的 days_csv 与 CLI --out 写盘产物逐字节
    // 一致——浏览器下载的 days.csv 可直接被 sandtable report / query 继续分析
    let cli_days = fs::read_to_string(dir.join("days.csv")).unwrap();
    assert_eq!(
        cli_days,
        web["days_csv"].as_str().unwrap(),
        "days.csv 与 CLI --out 产物逐字节一致"
    );
}

/// A/B 端到端对照(WB-10.03):CLI `compare` 从一个基线只改 warrior.attack 派生
/// 两个候选,wasm 侧用同基线写出的两份候选 YAML 走同一条内核链。config_hash
/// 证明两侧确实是同一基线派生的两个候选;comparison 逐字段一致(配对差值、
/// 置信区间、效应量、判定)。
#[test]
fn ab_compare_matches_cli_compare() {
    let dir = scratch("st-ab-cli");

    // 基线不含 model 节:CLI 从同一份基线覆盖 attack,wasm 侧把 attack 写进
    // 候选 YAML,两条路的 cfg 应完全等价(config_hash 就是这条断言的证据)
    let base = concat!(
        "schema_version: \"1\"\n",
        "scenario: {population: 400, duration: \"14d\", seed: 42}\n",
    );
    let base_yaml = dir.join("base.yaml");
    fs::write(&base_yaml, base).unwrap();

    // CLI 的 compare 只把 warrior.attack 当被改参数;power_p50 是唯一随它
    // 变化的指标(留存/胜率在该档下不变),故用它做端到端对照
    let ab_out = dir.join("ab");
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "compare",
            base_yaml.to_str().unwrap(),
            "--attack-a",
            "90",
            "--attack-b",
            "150",
            "--replicates",
            "8",
            "--metric",
            "power_p50",
            "--out",
            ab_out.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let cli: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ab_out.join("comparison.json")).unwrap()).unwrap();

    const R: u32 = 8;
    let arm_yaml = |attack: i64| format!("{base}model:\n  warrior:\n    attack: {attack}\n");
    let ya = arm_yaml(90);
    let yb = arm_yaml(150);
    let ra = sandtable_wasm::run_simulation_native(&ya, R).unwrap();
    let rb = sandtable_wasm::run_simulation_native(&yb, R).unwrap();

    // 同一基线派生两个候选:两侧哈希一致,且两个候选不是同一个配置
    same(&cli["attack_a"], &serde_json::json!(90), "attack_a");
    same(&cli["attack_b"], &serde_json::json!(150), "attack_b");
    assert_eq!(
        ra["config_hash"], cli["hash_a"],
        "base 臂 YAML 与 CLI 派生的 cfg_a 哈希一致"
    );
    assert_eq!(
        rb["config_hash"], cli["hash_b"],
        "cand 臂 YAML 与 CLI 派生的 cfg_b 哈希一致"
    );
    assert_ne!(cli["hash_a"], cli["hash_b"], "两个候选不是同一个配置");

    // 绑定直出 Comparison 本体;CLI 把它嵌在 comparison.json 的 comparison 键下
    let wc = &sandtable_wasm::ab_compare_native(
        &ya,
        &yb,
        "power_p50",
        &ra["results"].to_string(),
        &rb["results"].to_string(),
    )
    .unwrap();
    let cc = &cli["comparison"];

    // 两入口逐字段一致:指标名/判定精确,数值与逐臂统计容差
    for k in ["metric", "verdict"] {
        assert_eq!(wc[k], cc[k], "{k}");
    }
    for k in ["diff_mean", "diff_ci95_lo", "diff_ci95_hi", "effect_size_d"] {
        same(&wc[k], &cc[k], k);
    }
    for arm in ["arm_a", "arm_b"] {
        for k in ["n", "mean", "sd", "ci95_lo", "ci95_hi"] {
            same(&wc[arm][k], &cc[arm][k], &format!("{arm}.{k}"));
        }
    }
    assert_eq!(wc["metric"], "power_p50");
    assert_eq!(wc["arm_a"]["n"], 8);
}

/// A/B 配对统计对照(WB-10.03):同一基线改 model.dungeon.m_attack 派生两个
/// 候选,CLI 各自真跑 12 个 replicate。三方一致——CLI 的 report.json ≡ wasm
/// `run_simulation` 的 results ≡ 内核 `compare` 直接吃 CLI 自己的原始逐
/// replicate 值;后者证明 `compare_arms` 的指标提取不丢值、不错序。
/// 用留存指标(随副本怪物攻击有真实波动)覆盖配对 t 区间,不是点估计退化。
#[test]
fn ab_compare_matches_kernel_on_cli_arms() {
    let dir = scratch("st-ab-retention");
    let base = concat!(
        "schema_version: \"1\"\n",
        "scenario: {population: 400, duration: \"14d\", seed: 42}\n",
    );
    let arm_yaml = |m_attack: i64| format!("{base}model:\n  dungeon:\n    m_attack: {m_attack}\n");
    const R: u32 = 12;

    // CLI 端:两份候选 YAML 各真跑一遍,留下原始逐 replicate 值
    let mut cli = Vec::new();
    for (name, attack) in [("a", 10i64), ("b", 120i64)] {
        let y = arm_yaml(attack);
        let yaml_path = dir.join(format!("arm{name}.yaml"));
        let out_dir = dir.join(format!("arm{name}"));
        fs::write(&yaml_path, &y).unwrap();
        let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
            .arg("simulate")
            .arg(&yaml_path)
            .arg("--replicates")
            .arg(R.to_string().as_str())
            .arg("--out")
            .arg(&out_dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "arm{name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let rep: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(out_dir.join("report.json")).unwrap())
                .unwrap();
        cli.push((y, rep));
    }

    // wasm 端:同一份候选 YAML 自己跑,逐 replicate 与 CLI 一致(含 config_hash)
    let (ra_cli, rb_cli) = (&cli[0].1, &cli[1].1);
    let ra_web = sandtable_wasm::run_simulation_native(&cli[0].0, R).unwrap();
    let rb_web = sandtable_wasm::run_simulation_native(&cli[1].0, R).unwrap();
    assert_eq!(
        ra_cli["results"], ra_web["results"],
        "arm_a 逐 replicate 一致"
    );
    assert_eq!(
        rb_cli["results"], rb_web["results"],
        "arm_b 逐 replicate 一致"
    );

    // 三方一致:wasm 桥接 ≡ 内核 compare 直接吃 CLI 的原始值
    let web = sandtable_wasm::ab_compare_native(
        &cli[0].0,
        &cli[1].0,
        "retention_d7",
        &ra_web["results"].to_string(),
        &rb_web["results"].to_string(),
    )
    .unwrap();
    let metric_vals = |rep: &serde_json::Value| {
        rep["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["retention_d7"].as_f64().unwrap())
            .collect::<Vec<_>>()
    };
    let kernel = serde_json::to_value(sandtable_core::experiment::compare(
        "retention_d7",
        &metric_vals(ra_cli),
        &metric_vals(rb_cli),
    ))
    .unwrap();
    for k in ["metric", "verdict"] {
        assert_eq!(web[k], kernel[k], "{k}");
    }
    for k in ["diff_mean", "diff_ci95_lo", "diff_ci95_hi", "effect_size_d"] {
        same(&web[k], &kernel[k], k);
    }
    for arm in ["arm_a", "arm_b"] {
        for k in ["n", "mean", "sd", "ci95_lo", "ci95_hi"] {
            same(&web[arm][k], &kernel[arm][k], &format!("{arm}.{k}"));
        }
    }

    // 这次确实走了配对 t 区间,不是退化的点估计:区间宽度 > 0 且臂内有波动
    let lo = web["diff_ci95_lo"].as_f64().unwrap();
    let hi = web["diff_ci95_hi"].as_f64().unwrap();
    let mean = web["diff_mean"].as_f64().unwrap();
    assert!(hi - lo > 1e-12, "配对差 CI 非零宽: {lo} {hi}");
    assert!(
        web["arm_a"]["sd"].as_f64().unwrap() > 0.0,
        "arm_a 有 replicate 波动"
    );
    assert!(
        web["arm_b"]["sd"].as_f64().unwrap() > 0.0,
        "arm_b 有 replicate 波动"
    );
    assert!(
        lo < mean && mean < hi,
        "配对差均值落在自身 CI 内({lo} < {mean} < {hi})"
    );
}
