// sandtable 桌面壳(Phase 7,拍板 2026-10-10:Linux 本机先行):
// Tauri 2 壳 + sandtable-core path 依赖直连——native 仿真,不经 wasm 边界。
// 命令面不含仿真语义:加载(错误透出)→ 逐 replicate 仿真 → 结果按
// CLI report.json / wasm run_simulation_native 的 results 同构序列化。
// 长任务(run_simulation)走异步命令 + spawn_blocking:逐 replicate 经
// Channel 上报进度,replicate 边界响应取消令牌(内核无中途退出面,粒度
// 刻意落在 replicate 之间,仿真语义零改动)。自动更新器、签名证书按拍板
// 后置。native 无 WASM 的 64 replicates / 200 预算门,更大实验本就是
// 桌面定位(文档 09 章边界)。
// 命令按域拆分:model(配置 / KPI / 参数)/ sim(仿真 + 进度 + 取消)/
// sweep / optimize / query(DuckDB)/ window;本文件只留入口 run() 与
// 命令面集成测试。
mod model;
mod optimize;
mod query;
mod sim;
mod sweep;
mod window;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(sim::TaskRegistry::default())
        .invoke_handler(tauri::generate_handler![
            model::validate_config,
            model::param_registry,
            model::param_values,
            model::param_apply,
            model::kpi_availability,
            model::kpi_validate,
            model::kpi_eval,
            model::metric_dictionary,
            model::ab_compare,
            model::daily_aggregate,
            sim::run_simulation,
            sim::cancel_run,
            sweep::sweep_plan,
            sweep::sweep_candidate,
            sweep::sweep_recommend,
            optimize::optimize,
            optimize::surrogate_train,
            optimize::surrogate_predict,
            query::query,
        ])
        .setup(|app| {
            window::main_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 主窗在此构建而非由 tauri.conf.json 自动建:download 拦截必须挂在
/// WebviewBuilder 上,配置窗口建完无法补挂——无 decide-destination 应答时
/// WebKitGTK 直接取消下载,前端 blob 锚点下载在桌面静默失效(docs 18 Phase 7
/// 清单第 6 步)。放大/缩小交给 WebView 自身:Windows 走 WebView2 的
/// IsZoomControlEnabled,macOS/Linux 注入 Ctrl/Cmd + - = + / 0 与 Ctrl+滚轮
/// 多面缩放(20% 步进,0.2–10),polyfill 回调的
/// plugin:webview|set_webview_zoom 需主窗 capabilities 放行
/// core:webview:allow-set-webview-zoom,缺权限时缩放按键在 Linux/macOS 静默失效。
#[cfg(test)]
mod tests {
    // 命令在各域模块:测试按域 glob 导入。命令宏的隐藏 __cmd__ item 不能
    // 被 use 重导入(显式导入会 E0255),glob 只带普通 item,无冲突。
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    use tauri::ipc::{Channel, InvokeResponseBody};
    use tauri::Manager;

    use crate::model::*;
    use crate::optimize::*;
    use crate::query::*;
    use crate::sim::*;
    use crate::sweep::*;
    use crate::window::*;

    fn fresh_flag() -> CancelFlag {
        Arc::new(AtomicBool::new(false))
    }

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );
    const EXP_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );
    const OPT_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 20, duration: '3d', seed: 42}\n",
        "optimize:\n",
        "  mode: evolutionary\n",
        "  population: 4\n",
        "  generations: 2\n",
        "  elite: 1\n",
        "  mutation_rate: 0.3\n",
        "  mutation_scale: 0.2\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 20, max: 200}\n",
        "  targets:\n",
        "    - {metric: churn_rate, min: 0.0, max: 1.0, kind: hard}\n",
        "  objective:\n",
        "    metric: win_rate\n",
        "    direction: maximize\n",
    );

    /// 主窗经 mock 运行时可构建,下载拦截与放大开关挂在同一个「main」窗口上
    /// (mock 运行时不记窗口属性,缩放开关本身由
    /// desktop_capabilities_allow_webview_zoom 守)。
    #[test]
    fn main_window_builds_with_zoom_hotkeys() {
        let app = tauri::test::mock_app();
        let w = main_window(app.handle()).unwrap();
        assert_eq!(w.label(), "main");
    }

    /// macOS/Linux 的多面缩放是初始化脚本,回调 plugin:webview|set_webview_zoom
    /// 要主窗 capabilities 放行;权限丢了缩放按键静默失效——这里拦住。
    #[test]
    fn desktop_capabilities_allow_webview_zoom() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        assert_eq!(v["windows"], serde_json::json!(["main"]));
        let perms = v["permissions"].as_array().unwrap();
        assert!(
            perms.contains(&serde_json::json!("core:webview:allow-set-webview-zoom")),
            "主窗未放行 webview 缩放权限"
        );
    }

    /// Windows 图标链回归守卫:exe 资源、ARPPRODUCTICON 与开始菜单快捷方式的
    /// 图标都来自 bundle.icon 里的 icons/icon.ico(上游 WiX 模板经 {{icon_path}}
    /// 织入),NSIS 与 Linux 各取自己的 png/icns。配置引用必须在盘上——缺文件
    /// 要到 Windows 打包腿才炸,本机不可验;ico 必须含 256×256,缺大尺寸时
    /// Win10/11 的大图标位直接糊掉。
    #[test]
    fn windows_bundle_icon_chain_is_complete() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let conf: serde_json::Value =
            serde_json::from_reader(std::fs::File::open(dir.join("tauri.conf.json")).unwrap())
                .unwrap();
        let icons = conf["bundle"]["icon"].as_array().unwrap();
        let names: Vec<String> = icons
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect();
        assert!(
            names.iter().any(|n| n.ends_with("icon.ico")),
            "Windows 面必须引用 icon.ico"
        );
        for n in &names {
            assert!(dir.join(n).is_file(), "bundle.icon 引用的 {n} 不在盘上");
        }

        let b = std::fs::read(dir.join("icons/icon.ico")).unwrap();
        assert_eq!(u16::from_le_bytes([b[0], b[1]]), 0, "ICO 保留位");
        assert_eq!(u16::from_le_bytes([b[2], b[3]]), 1, "必须是图标类型");
        let count = u16::from_le_bytes([b[4], b[5]]) as usize;
        assert!(count >= 4, "多尺寸 ICO");
        let mut dims = std::collections::BTreeSet::new();
        for i in 0..count {
            let e = &b[6 + i * 16..6 + (i + 1) * 16];
            let dim = |v: u8| -> u32 {
                if v == 0 {
                    256
                } else {
                    v as u32
                }
            };
            assert_eq!(dim(e[0]), dim(e[1]), "各尺寸必须方形");
            assert_eq!(u16::from_le_bytes([e[6], e[7]]), 32, "各尺寸 32bpp");
            let size = u32::from_le_bytes([e[8], e[9], e[10], e[11]]) as usize;
            let off = u32::from_le_bytes([e[12], e[13], e[14], e[15]]) as usize;
            assert!(
                off + size <= b.len(),
                "ICO 目录项越界(off={off} size={size})"
            );
            dims.insert(dim(e[0]));
        }
        for need in [16u32, 32, 48, 256] {
            assert!(dims.contains(&need), "ICO 缺 {need}×{need} 尺寸");
        }
    }

    #[test]
    fn validate_valid_and_invalid() {
        let v = validate_config(YAML.into()).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert!(v["config_hash"].as_str().unwrap().len() == 64);
        assert!(validate_config(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n".into()
        )
        .unwrap_err()
        .starts_with("配置错误"));
    }

    #[test]
    fn ab_compare_matches_kernel_semantics() {
        let cand = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_impl(YAML, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let b = run_simulation_impl(cand, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let v = ab_compare(
            YAML.into(),
            cand.into(),
            "win_rate".into(),
            a["results"].to_string(),
            b["results"].to_string(),
        )
        .unwrap();
        assert_eq!(v["metric"], "win_rate");
        assert_eq!(v["arm_a"]["n"], 4);
        assert!(["BHigher", "AHigher", "NoDifference"].contains(&v["verdict"].as_str().unwrap()));
        // 错误通道:未知指标是参数错误;种子错位是配置错误(与 wasm 同构)
        assert!(ab_compare(
            YAML.into(),
            YAML.into(),
            "winrate".into(),
            a["results"].to_string(),
            a["results"].to_string(),
        )
        .unwrap_err()
        .starts_with("参数错误"));
        let other_seed = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let c = run_simulation_impl(other_seed, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let err = ab_compare(
            YAML.into(),
            other_seed.into(),
            "win_rate".into(),
            a["results"].to_string(),
            c["results"].to_string(),
        )
        .unwrap_err();
        assert!(
            err.starts_with("配置错误") && err.contains("base_seed 不一致"),
            "{err}"
        );
    }

    #[test]
    fn run_matches_wasm() {
        let v = run_simulation_impl(YAML, 2, &fresh_flag(), &mut |_| {}).unwrap();
        let results = v["results"].as_array().unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0]["config_hash"], results[1]["config_hash"]);
        assert!(v["days_csv"].as_str().unwrap().starts_with("day,active,"));
        assert_eq!(v["meta"]["schema_version"], sandtable_core::SCHEMA_VERSION);
        assert!(run_simulation_impl(YAML, 0, &fresh_flag(), &mut |_| {}).is_err());
    }

    /// 进度回调逐 replicate 上报且不打乱仿真:与无进度路径的结果逐值一致。
    #[test]
    fn run_replicates_reports_progress_per_replicate() {
        let cfg = load(YAML).unwrap();
        let mut seen = Vec::new();
        let results = run_replicates(&cfg, 3, &fresh_flag(), &mut |done| seen.push(done)).unwrap();
        assert_eq!(seen, vec![1, 2, 3]);
        let plain: Vec<_> = (0..3u32)
            .map(|r| sandtable_core::sim::run(&cfg, r))
            .collect();
        assert_eq!(
            serde_json::to_value(&results).unwrap(),
            serde_json::to_value(&plain).unwrap(),
            "进度回调不得改变仿真结果"
        );
    }

    /// 取消在 replicate 边界生效:第 2 个 replicate 完成后置位,第 3 个不再
    /// 开跑;错误信息带已完成计数,且不产出半截结果。
    #[test]
    fn run_replicates_cancels_at_replicate_boundary() {
        let cfg = load(YAML).unwrap();
        let cancel = fresh_flag();
        let mut last_done = 0;
        let err = run_replicates(&cfg, 5, &cancel, &mut |done| {
            last_done = done;
            if done == 2 {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .unwrap_err();
        assert_eq!(last_done, 2);
        assert!(err.contains("已取消"), "{err}");
        assert!(err.contains("2/5"), "{err}");

        // 开跑前已取消:0 个 replicate 完成,计数 0/5
        let pre = fresh_flag();
        pre.store(true, Ordering::Relaxed);
        let err = run_replicates(&cfg, 5, &pre, &mut |_| {}).unwrap_err();
        assert!(err.contains("0/5"), "{err}");
    }

    /// 命令层全链(mock app + 真实 Channel):进度事件逐条推达,任务结束
    /// 令牌被清理,产物与 impl 路径逐值一致。
    #[test]
    fn run_command_streams_progress_and_cleans_registry() {
        let app = tauri::test::mock_app();
        app.manage(TaskRegistry::default());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::<ProgressEvent>::new(move |body| {
            match body {
                InvokeResponseBody::Json(s) => {
                    let ev: ProgressEvent = serde_json::from_str(&s).unwrap();
                    sink.lock().unwrap().push((ev.done, ev.total));
                }
                other => panic!("进度事件应为 JSON,得到 {other:?}"),
            }
            Ok(())
        });
        let out =
            tauri::async_runtime::block_on(run_simulation(YAML.into(), 3, channel, app.state()))
                .unwrap();
        assert_eq!(out["results"].as_array().unwrap().len(), 3);
        assert_eq!(*seen.lock().unwrap(), vec![(1, 3), (2, 3), (3, 3)]);
        assert!(
            app.state::<TaskRegistry>().take().is_none(),
            "任务结束须清理令牌"
        );
        // 与 impl 路径逐值一致(同配置同 seed)
        let plain = run_simulation_impl(YAML, 3, &fresh_flag(), &mut |_| {}).unwrap();
        assert_eq!(out["results"], plain["results"]);
        assert_eq!(out["days_csv"], plain["days_csv"]);
    }

    /// 取消命令语义:无活动任务为无操作(false);活动任务被置位(true)。
    #[test]
    fn cancel_run_hits_only_active_task() {
        let app = tauri::test::mock_app();
        app.manage(TaskRegistry::default());
        assert!(!cancel_run(app.state()));
        let flag = app.state::<TaskRegistry>().register();
        assert!(cancel_run(app.state()));
        assert!(flag.load(Ordering::Relaxed));
        assert!(app.state::<TaskRegistry>().take().is_some());
        assert!(!cancel_run(app.state()), "清理后再取消为无操作");
    }

    #[test]
    fn sweep_plan_candidate_recommend_match_core() {
        let plan = sweep_plan(EXP_YAML.into(), 0).unwrap();
        assert_eq!(plan["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(plan["sims"], 6);

        let values = r#"{"model.warrior.attack": 100.0}"#;
        let cand = sweep_candidate_impl(EXP_YAML, 2, values).unwrap();
        let (cfg, spec) = sandtable_core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let want = sandtable_core::sweep::run_candidate(
            &cfg,
            &spec,
            &std::collections::BTreeMap::from([("model.warrior.attack".into(), 100.0)]),
        );
        assert_eq!(cand, serde_json::to_value(want).unwrap());

        let mut results = Vec::new();
        for values in spec.plan(cfg.base_seed).unwrap() {
            results.push(sandtable_core::sweep::run_candidate(&cfg, &spec, &values));
        }
        let results_json = serde_json::to_string(&results).unwrap();
        let v = sweep_recommend(EXP_YAML.into(), results_json).unwrap();
        assert_eq!(v["recommendation"]["param"], "model.warrior.attack");
        assert_eq!(
            v["elasticities"].as_array().unwrap().len(),
            sandtable_core::experiment::MetricKey::ALL.len()
        );
        assert!(sweep_candidate_impl(EXP_YAML, 0, values).is_err());
        assert!(sweep_recommend("no sweep".into(), "[]".into()).is_err());
    }

    /// 校验通道:桌面与 wasm 接受同一份实验 YAML(sweep 节摘出)且逐字段
    /// 一致;执行入口不变(只收场景 YAML)。前端提交纪律要求送达的输入
    /// 快照(含 sweep 节)整份被内核校验,否则 sweep 节被当作未知顶层键。
    #[test]
    fn validate_config_accepts_experiment_yaml() {
        let d = validate_config(EXP_YAML.into()).unwrap();
        let w = sandtable_wasm::validate_config_native(EXP_YAML).unwrap();
        assert_eq!(d, w, "桌面与 wasm 校验通道逐字段一致");
        assert!(
            d["config_hash"].as_str().unwrap().len() == 64,
            "SHA-256 hex"
        );
        // 执行入口只收场景 YAML:load_str 对顶层 sweep 节照旧拒绝
        assert!(
            sandtable_core::scenario::load_str(EXP_YAML).is_err(),
            "执行入口不吞实验节"
        );
    }

    /// 寻优/代理三命令:桌面 core 直连与 wasm 绑定逐字段一致;桌面 native
    /// 无 Web 预算门是刻意定位(同 sweep_plan 口径),Web 红线仍在 wasm 层。
    #[test]
    fn optimize_and_surrogate_match_wasm() {
        // 代理训练/预测:同一内核森林,训练账 + 重要性 + 模型 JSON 同构
        let (cfg, spec) = sandtable_core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let mut results = Vec::new();
        for values in spec.plan(cfg.base_seed).unwrap() {
            results.push(sandtable_core::sweep::run_candidate(&cfg, &spec, &values));
        }
        let results_json = serde_json::to_string(&results).unwrap();
        let d = surrogate_train(results_json.clone(), "win_rate".into(), 16, 5, 2, 7).unwrap();
        let w =
            sandtable_wasm::surrogate_train_native(&results_json, "win_rate", 16, 5, 2, 7).unwrap();
        assert_eq!(d, w, "代理训练输出与 wasm 同构");
        assert_eq!(d["trained"], 3);
        assert_eq!(d["excluded"], 0);

        let point = r#"{"model.warrior.attack": 100.0}"#;
        let pd = surrogate_predict(d["model"].to_string(), point.into()).unwrap();
        let pw = sandtable_wasm::surrogate_predict_native(&d["model"].to_string(), point).unwrap();
        assert_eq!(pd, pw, "预测与树间分歧包络与 wasm 同构");
        let mean = pd["mean"].as_f64().unwrap();
        assert!(
            pd["spread_min"].as_f64().unwrap() <= mean
                && mean <= pd["spread_max"].as_f64().unwrap(),
            "树间分歧两端夹住森林均值"
        );
        // 红线:分歧字段名不带 ci/confidence/interval/band 语义(内核面已锁,桥接面复验)
        let pd_json = pd.to_string().to_lowercase();
        for forbidden in ["ci", "confidence", "interval", "band"] {
            assert!(
                !pd_json.contains(forbidden),
                "预测 JSON 不得出现 {forbidden}"
            );
        }

        // 寻优:小预算下桌面与 wasm 逐字段一致
        let od = optimize(OPT_YAML.into()).unwrap();
        let ow = sandtable_wasm::optimize_native(OPT_YAML).unwrap();
        assert_eq!(od, ow, "寻优输出与 wasm 同构");
        assert_eq!(od["spec"]["mode"], "evolutionary");

        // 预算门分野:同一份超 Web 预算(800 > 200)实验,桌面放行、wasm 拒绝
        let big = OPT_YAML
            .replace(
                "  population: 4\n  generations: 2\n",
                "  population: 20\n  generations: 1\n",
            )
            .replace("  replicates: 2\n", "  replicates: 20\n");
        assert!(
            optimize(big.clone()).is_ok(),
            "桌面无 Web 预算门:更大寻优是桌面定位"
        );
        assert!(
            sandtable_wasm::optimize_native(&big).is_err(),
            "Web 路径预算红线仍在 wasm 层拦截"
        );
    }

    #[test]
    fn run_wasm_parity_same_config_seed() {
        // 三角口径(文档 18 章 Phase 7 验收):web_parity 已锁 wasm↔CLI
        // 逐值一致,本测试锁 desktop↔wasm——两条腿合起来,桌面与 CLI
        // 同配置同 seed 产物等价(同一内核的三个入口)。配置用宝可梦案例,
        // 与 web_parity 同源,覆盖 dungeon / progression 真实形状。
        let yaml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../examples/pokemon.yaml"
        ))
        .unwrap();
        let v = run_simulation_impl(&yaml, 2, &fresh_flag(), &mut |_| {}).unwrap();
        let w = sandtable_wasm::run_simulation_native(&yaml, 2).unwrap();
        assert_eq!(v["results"], w["results"], "results 逐值一致");
        assert_eq!(v["config_hash"], w["config_hash"], "config_hash 一致");
        assert_eq!(v["days_csv"], w["days_csv"], "days_csv 逐字节一致");
    }

    #[test]
    fn param_writeback_parity_wasm_native() {
        // WB-03.17 · 同一配置对照参数回写:数值读取全表(含 u64 无损通道)、
        // 应用回写(config_hash + 回读值)、KPI 可用性,桌面命令与 wasm
        // native 逐值一致;非法路径同通道显式拒绝,错误文案逐字一致。
        let yaml = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../examples/pokemon.yaml"
        ))
        .unwrap();
        assert_eq!(
            param_values(yaml.clone()).unwrap(),
            sandtable_wasm::param_values_native(&yaml).unwrap(),
            "数值读取全表逐键一致",
        );
        let v = param_apply(yaml.clone(), "model.warrior.attack".into(), 250.0).unwrap();
        let w = sandtable_wasm::param_apply_native(&yaml, "model.warrior.attack", 250.0).unwrap();
        assert_eq!(v, w, "应用回写 config_hash 与回读值一致");
        let err_d = param_apply(yaml.clone(), "model.no_such".into(), 1.0).unwrap_err();
        let err_w = sandtable_wasm::param_apply_native(&yaml, "model.no_such", 1.0).unwrap_err();
        assert!(err_d.starts_with("配置错误"), "{err_d}");
        assert_eq!(err_d, err_w, "非法路径错误文案逐字一致");
        assert_eq!(
            kpi_availability(yaml.clone()).unwrap(),
            sandtable_wasm::kpi_availability_native(&yaml).unwrap(),
            "KPI 可用性同表",
        );
    }

    #[test]
    fn kpi_custom_parity_wasm_native() {
        // 自定义 KPI:桌面命令与 wasm native 同源,校验 / 求值两条通道逐值
        // 一致,校验错误文案逐字一致。
        let week = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '7d', seed: 7}\n",
        );
        let sim = run_simulation_impl(week, 3, &fresh_flag(), &mut |_| {}).unwrap();
        let results = sim["results"].to_string();

        let expr = "max(win_rate, retention_d7) + churn_rate";
        assert_eq!(
            kpi_validate(expr.into()).unwrap(),
            sandtable_wasm::kpi_validate_native(expr).unwrap(),
            "校验形状一致"
        );
        assert_eq!(
            kpi_eval("retention_d7".into(), results.clone()).unwrap(),
            sandtable_wasm::kpi_eval_native("retention_d7", &results).unwrap(),
            "求值与跨 replicate 聚合一致"
        );
        // 校验错误文案逐字一致(配置错误通道,不前端改写)
        for bad_expr in ["not_a_metric * 2", "0.5", ""] {
            let err_d = kpi_validate(bad_expr.into()).unwrap_err();
            let err_w = sandtable_wasm::kpi_validate_native(bad_expr).unwrap_err();
            assert_eq!(err_d, err_w, "{bad_expr} 错误文案逐字一致");
        }
        // 红线一:单次运行不给统计区间
        let one = serde_json::json!([sim["results"][0].clone()]);
        let r = kpi_eval("retention_d7".into(), one.to_string()).unwrap();
        assert_eq!(r["n_used"], 1);
        assert!(r["stats"].is_null(), "n < 2 不给置信带");
        // 红线二:缺席指标不填 0(3 天配置下 d7 未定义)
        let short = run_simulation_impl(YAML, 2, &fresh_flag(), &mut |_| {}).unwrap();
        let s = kpi_eval("retention_d7".into(), short["results"].to_string()).unwrap();
        assert_eq!(s["n_used"], 0);
        assert!(s["per_replicate"][0].is_null(), "缺席不填 0");
        // 求值通道同样走编译校验
        let err = kpi_eval("win_rates".into(), results).unwrap_err();
        assert!(err.contains("配置错误"), "{err}");
    }

    #[test]
    fn metric_dictionary_parity_wasm_native() {
        // 指标字典:桌面命令与 wasm native 逐值一致(机器口径事实源单点)
        assert_eq!(
            metric_dictionary().unwrap(),
            sandtable_wasm::metric_dictionary_native().unwrap(),
            "字典逐字段一致"
        );
        let v = metric_dictionary().unwrap();
        assert_eq!(v["dict_version"], "1", "字典契约版本在场");
        assert_eq!(v["metrics"].as_array().unwrap().len(), 8, "内置指标全集");
    }

    #[test]
    fn ab_stats_parity_wasm_native() {
        // WB-03.17 · 同一双臂对照 A/B 统计:同一内核 compare_arms,桌面命令
        // 与 wasm native 的 Comparison 逐字段一致(含 verdict / CI / 效应量);
        // 未知指标与种子错位的错误通道同构,文案逐字一致。
        let base = YAML.to_string();
        let cand = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_impl(base.as_str(), 4, &fresh_flag(), &mut |_| {}).unwrap();
        let b = run_simulation_impl(cand, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let results_a = a["results"].to_string();
        let results_b = b["results"].to_string();
        let d = ab_compare(
            base.clone(),
            cand.into(),
            "win_rate".into(),
            results_a.clone(),
            results_b.clone(),
        )
        .unwrap();
        let w = sandtable_wasm::ab_compare_native(&base, cand, "win_rate", &results_a, &results_b)
            .unwrap();
        assert_eq!(d, w, "A/B 统计 Comparison 逐字段一致");
        assert!(["BHigher", "AHigher", "NoDifference"].contains(&d["verdict"].as_str().unwrap()));
        assert_eq!(
            ab_compare(
                base.clone(),
                base.clone(),
                "winrate".into(),
                results_a.clone(),
                results_a.clone()
            )
            .unwrap_err(),
            sandtable_wasm::ab_compare_native(&base, &base, "winrate", &results_a, &results_a)
                .unwrap_err(),
            "未知指标错误文案逐字一致",
        );
        let other_seed = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let c = run_simulation_impl(other_seed, 4, &fresh_flag(), &mut |_| {}).unwrap();
        let err_d = ab_compare(
            base.clone(),
            other_seed.into(),
            "win_rate".into(),
            results_a.clone(),
            c["results"].to_string(),
        )
        .unwrap_err();
        let err_w = sandtable_wasm::ab_compare_native(
            &base,
            other_seed,
            "win_rate",
            &results_a,
            &c["results"].to_string(),
        )
        .unwrap_err();
        assert!(err_d.contains("base_seed 不一致"), "{err_d}");
        assert_eq!(err_d, err_w, "种子错位错误文案逐字一致");
    }

    #[test]
    fn query_csv_view() {
        let dir = std::env::temp_dir().join(format!("st-desktop-query-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("summary.csv");
        std::fs::write(&f, "a,b\n1,2\n3,4\n").unwrap();
        let v = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT sum(a) AS s, count(*) AS n FROM summary".into(),
        )
        .unwrap();
        assert_eq!(v["columns"], serde_json::json!(["s", "n"]));
        assert_eq!(v["rows"], serde_json::json!([["4", "2"]]));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 与 CLI query 同源的 is_ident 守卫:非法词根(数字开头 + 空格)必须
    /// 在注册前被拦,报错含「非法」。
    #[test]
    fn query_rejects_illegal_view_name() {
        let dir = std::env::temp_dir().join(format!("st-desktop-query-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("9bad name.csv");
        std::fs::write(&f, "a\n1\n").unwrap();
        let err = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT * FROM t".into(),
        )
        .unwrap_err();
        assert!(err.contains("非法"), "{err}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// 合法词根 + 路径含单引号:DDL 字面量 `'`→`''` 翻倍必须兜住(与 CLI
    /// query_path_with_quote_still_queries 同口径,桌面侧独立锁死)。
    #[test]
    fn query_path_with_quote_still_queries() {
        let dir =
            std::env::temp_dir().join(format!("st-desktop-query-quote-{}", std::process::id()));
        let quoted = dir.join("it's out");
        std::fs::create_dir_all(&quoted).unwrap();
        let f = quoted.join("summary.csv");
        std::fs::write(&f, "a\n5\n6\n").unwrap();
        let v = query(
            vec![f.to_string_lossy().into_owned()],
            "SELECT count(*) AS n FROM summary".into(),
        )
        .unwrap();
        assert_eq!(v["rows"], serde_json::json!([["2"]]));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// I-010:只读 SQL 白名单——文件表函数与写语句必须被拒。
    #[test]
    fn query_rejects_file_functions_and_writes() {
        // 文件表函数与语句内嵌写操作:SELECT/WITH 前缀通过后被词表拦下,
        // 错误信息点名被禁关键词。
        for (sql, needle) in [
            (
                "SELECT * FROM read_csv_auto('/etc/passwd')",
                "READ_CSV_AUTO",
            ),
            (
                "SELECT * FROM read_parquet('/data/x.parquet')",
                "READ_PARQUET",
            ),
            // 2026-11-05 审核发现:标量/表文件读取函数原漏词表,补齐后必须被拦。
            ("SELECT * FROM read_text('/etc/passwd')", "READ_TEXT"),
            ("SELECT * FROM read_blob('/etc/passwd')", "READ_BLOB"),
            ("SELECT * FROM read_ndjson('/data/x.json')", "READ_NDJSON"),
            (
                "SELECT * FROM read_ndjson_auto('/data/x.json')",
                "READ_NDJSON_AUTO",
            ),
            (
                "SELECT * FROM read_json_objects('/data/x.json')",
                "READ_JSON_OBJECTS",
            ),
            (
                "SELECT * FROM read_json_objects_auto('/data/x.json')",
                "READ_JSON_OBJECTS_AUTO",
            ),
            (
                "SELECT * FROM parquet_scan('/data/x.parquet')",
                "PARQUET_SCAN",
            ),
            ("SELECT * FROM glob('/tmp/*')", "GLOB"),
            ("SELECT * FROM t; DELETE FROM t", "DELETE"),
        ] {
            let err = validate_query_sql(sql).unwrap_err();
            assert!(err.contains(needle), "{sql} -> {err}");
        }
        // 非 SELECT/WITH 前缀(COPY/INSERT/CREATE 等):前置只读门直接拒绝,
        // 错误信息是通用「仅允许只读 SELECT/WITH」,不点具体词。
        for sql in [
            "COPY (SELECT * FROM t) TO '/tmp/x.csv'",
            "INSERT INTO t VALUES (1)",
            "CREATE TABLE t AS SELECT 1",
        ] {
            let err = validate_query_sql(sql).unwrap_err();
            assert!(err.contains("仅允许只读"), "{sql} -> {err}");
        }
        assert!(validate_query_sql("SELECT * FROM t").is_ok());
        assert!(validate_query_sql("WITH x AS (SELECT 1) SELECT * FROM x").is_ok());
        assert!(validate_query_sql("SELECTED").is_err());
    }

    /// I-010:输入路径 canonicalize 后必须是存在的普通文件。
    #[test]
    fn query_rejects_non_file_or_missing_input() {
        let dir = std::env::temp_dir().join(format!("st-desktop-query-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(resolve_query_input(&dir.to_string_lossy()).is_err());
        assert!(resolve_query_input("/no/such/file.csv").is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    /// ST-AUD-11 / I-011:桌面 run_simulation 对大 R 返回结构化错误,
    /// 不得先 `Vec::with_capacity` 申请巨量内存导致进程 abort。
    #[test]
    fn run_simulation_rejects_large_replicates_before_allocation() {
        let flag = CancelFlag::new(std::sync::atomic::AtomicBool::new(false));
        let mut progress = |_done: u32| {};
        let err = run_simulation_impl(
            "schema_version: \"1\"\nscenario: {population: 10, duration: \"3d\", seed: 7}\n",
            MAX_REPLICATES + 1,
            &flag,
            &mut progress,
        )
        .unwrap_err();
        assert!(
            err.contains("replicates 上限"),
            "应返回结构化错误而非 OOM/abort: {err}"
        );
    }

    /// 下载落点:重名加序号,不静默覆盖上一次导出的产物(第 6 步下载接线)。
    #[test]
    fn download_destination_uniquifies() {
        let dir = std::env::temp_dir().join(format!("st-desktop-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(download_destination(&dir, "days.csv"), dir.join("days.csv"));
        std::fs::write(dir.join("days.csv"), "x").unwrap();
        assert_eq!(
            download_destination(&dir, "days.csv"),
            dir.join("days (1).csv")
        );
        std::fs::write(dir.join("days (1).csv"), "x").unwrap();
        assert_eq!(
            download_destination(&dir, "days.csv"),
            dir.join("days (2).csv")
        );
        // 无扩展名保持原样
        assert_eq!(download_destination(&dir, "report"), dir.join("report"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
