//! 契约导出 / 参考导入 / 回流约定的回归测试(设计文档 §6 阶段 0–2)。

use sandtable_engine::backflow::{backflow_load, backflow_matches, BackflowReport, MetricPoint};
use sandtable_engine::contract::{
    export, export_from_yaml, export_json, EngineContract, KIND_CONTRACT, SCHEMA_VERSION,
};
use sandtable_engine::importer::load;
use std::collections::BTreeMap;
use std::fs;

fn pokemon_yaml() -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");
    fs::read_to_string(path).expect("examples/pokemon.yaml 应在仓库内")
}

fn pokemon_config() -> sandtable_core::config::SimConfig {
    sandtable_core::scenario::load_str(&pokemon_yaml()).expect("pokemon.yaml 应可加载")
}

fn pokemon() -> EngineContract {
    export_from_yaml(&pokemon_yaml()).expect("pokemon.yaml 导出应通过 validate")
}

// —— 阶段 0:契约 v0 草案 ——

#[test]
fn pokemon_contract_carries_semantic_layer() {
    let c = pokemon();
    assert_eq!(c.kind, KIND_CONTRACT);
    assert_eq!(c.schema_version, SCHEMA_VERSION);
    assert_eq!(c.config_hash.len(), 64);
    assert!(c.config_hash.bytes().all(|b| b.is_ascii_hexdigit()));

    // 战斗:比值口径 + 有效值导出
    assert_eq!(c.model.combat.damage_model, "ratio");
    assert_eq!(c.model.combat.ratio_k, 260.0);
    assert_eq!(c.model.combat.p_hit, 0.95);
    assert_eq!(c.model.combat.max_rounds, 32);

    // 练级产出面与行为配置
    let training = c.model.training.as_ref().expect("pokemon 配了练级面");
    assert_eq!(training.xp, 300);
    assert_eq!(training.gold, 100);
    assert_eq!(c.model.behavior.casual.p_training, 0.5);
    assert_eq!(c.model.behavior.core.sessions_int, 2);
    assert_eq!(c.model.behavior.whale.sessions_int, 5);

    // 公式槽(默认表达式原文)
    assert_eq!(c.model.formula.xp_needed, "xp_base * level ^ xp_pow");
}

#[test]
fn config_hash_matches_core() {
    let yaml = pokemon_yaml();
    let cfg = sandtable_core::scenario::load_str(&yaml).unwrap();
    let contract = export(&cfg).unwrap();
    assert_eq!(
        contract.config_hash,
        sandtable_core::config::config_hash(&cfg),
        "契约 config_hash 须与 core 同源"
    );
}

#[test]
fn pokemon_tier_table_exports_effective_rewards() {
    let c = pokemon();
    let rows = c
        .model
        .dungeon
        .tier_table
        .as_ref()
        .expect("pokemon 配了逐层表");
    assert_eq!(rows.len(), 8);
    // 行内 gold / xp 缺省 → 几何回退取整(reward · growth^tier 截断)
    assert_eq!(rows[0].hp, 165);
    assert_eq!(rows[0].gold, 1400);
    assert_eq!(rows[0].xp, 1080);
    assert_eq!(rows[7].gold, (1400.0 * 1.26f64.powi(7)) as i64);
    assert_eq!(rows[7].xp, (1080.0 * 1.31f64.powi(7)) as i64);
}

#[test]
fn absent_options_export_as_none() {
    let c = pokemon();
    assert!(c.model.gacha.is_none(), "pokemon 无抽卡系统");
    assert!(c.model.loot.is_none(), "pokemon 无掉落表");
}

#[test]
fn default_config_exports_difference_model_effective() {
    let cfg = sandtable_core::config::SimConfig::default();
    let c = export(&cfg).unwrap();
    // 缺省口径导出为显式 "difference"(有效值纪律,消费方不背沙盘缺省表)
    assert_eq!(c.model.combat.damage_model, "difference");
    assert_eq!(c.model.combat.ratio_k, 1.0);
    // 无逐层表 → 几何参数在场
    assert!(c.model.dungeon.tier_table.is_none());
    assert_eq!(c.model.dungeon.tiers, 8);
}

#[test]
fn export_rejects_invalid_config() {
    // players = 0:load_str 通过(校验在导出前),export 的同源 validate 拦截
    let yaml =
        "schema_version: '1'\nscenario:\n  population: 0\n  duration: 30d\n  seed: 1\nmodel: {}\n";
    let err = export_from_yaml(yaml).expect_err("players=0 应被 validate 拦");
    assert!(
        err.to_string().contains("players"),
        "错误应透传 core 原文: {err}"
    );
}

#[test]
fn export_json_is_deterministic() {
    let cfg = pokemon_config();
    let contract = export(&cfg).unwrap();
    assert_eq!(export_json(&cfg).unwrap(), contract.to_json());
    // 同配置两次导出逐字一致(确定性纪律)
    assert_eq!(contract.to_json(), export_json(&cfg).unwrap());
}

// 掉落结算面进契约(docs/loot-settlement-design.md §6):表 + 胜利绑定 +
// 条目数额全量导出,参考导入器按同口径校验。
#[test]
fn loot_settlement_contract_roundtrip() {
    let yaml = concat!(
        "schema_version: '1'\n",
        "scenario:\n  population: 100\n  duration: 30d\n  seed: 1\n",
        "model:\n",
        "  loot:\n",
        "    rate_mult: 1.5\n",
        "    on_victory: chest\n",
        "    tables:\n",
        "      chest:\n",
        "        weights:\n",
        "          gold_small: 70\n",
        "          xp_charm: 30\n",
        "    rewards:\n",
        "      gold_small: { gold: 10, xp: 0 }\n",
        "      xp_charm: { gold: 0, xp: 20 }\n",
    );
    let cfg = sandtable_core::scenario::load_str(yaml).expect("loot 配置应可加载");
    let contract = export(&cfg).expect("loot 配置导出应通过 validate");
    let loot = contract.model.loot.as_ref().expect("应携带掉落节");
    assert!((loot.rate_mult - 1.5).abs() < 1e-12);
    assert_eq!(loot.on_victory, "chest");
    assert_eq!(loot.tables["chest"].weights["gold_small"], 70.0);
    assert_eq!(loot.rewards["gold_small"].gold, 10);
    assert_eq!(loot.rewards["xp_charm"].xp, 20);
    let loaded = load(&contract.to_json()).expect("契约应能被参考导入器重新加载");
    assert_eq!(loaded, contract, "掉落节导出 / 加载应等价");

    // 胜利绑定指向不存在的表:导入器显式拒绝
    let mut broken = contract.clone();
    broken.model.loot.as_mut().unwrap().on_victory = "nope".into();
    let err = load(&broken.to_json()).expect_err("on_victory 指向缺失表应被拒");
    assert!(err.to_string().contains("on_victory"), "{err}");
}

// —— 阶段 1:参考导入器 + 回归 ——

#[test]
fn roundtrip_export_load_eq() {
    let c = pokemon();
    let loaded = load(&c.to_json()).expect("导出产物应能被参考导入器重新加载");
    assert_eq!(loaded, c, "重新加载与导出应等价");
}

#[test]
fn importer_rejects_bad_kind() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["kind"] = serde_json::json!("sandtable-contract");
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("kind 不符应拒");
    assert!(err.to_string().contains("kind"));
}

#[test]
fn importer_rejects_unsupported_schema_version() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["schema_version"] = serde_json::json!("0.2.0");
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("版本不符应拒");
    assert!(err.to_string().contains("0.2.0"));
}

#[test]
fn importer_rejects_bad_hash_shape() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["config_hash"] = serde_json::json!("zzzz");
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("hash 形态应拒");
    assert!(err.to_string().contains("config_hash"));
}

#[test]
fn importer_rejects_tier_table_length_mismatch() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["model"]["dungeon"]["tier_table"] = serde_json::json!([]);
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("表长与 tiers 不符应拒");
    assert!(err.to_string().contains("tiers"));
}

#[test]
fn importer_rejects_out_of_range_probability() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["model"]["combat"]["p_hit"] = serde_json::json!(1.5);
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("命中率越界应拒");
    assert!(err.to_string().contains("p_hit"));
}

#[test]
fn importer_rejects_unknown_damage_model() {
    let mut json = serde_json::to_value(pokemon()).unwrap();
    json["model"]["combat"]["damage_model"] = serde_json::json!("logistic");
    let err = load(&serde_json::to_string(&json).unwrap()).expect_err("口径值域应拒");
    assert!(err.to_string().contains("damage_model"));
}

// —— 阶段 2:回流约定 ——

fn pokemon_backflow() -> BackflowReport {
    let metric = sandtable_core::experiment::MetricKey::ALL[0];
    let mut metrics = BTreeMap::new();
    metrics.insert(
        metric.name().to_string(),
        MetricPoint {
            mean: 0.991,
            ci95: Some([0.988, 0.993]),
        },
    );
    BackflowReport {
        kind: sandtable_engine::contract::KIND_BACKFLOW.into(),
        schema_version: SCHEMA_VERSION.into(),
        config_hash: pokemon().config_hash,
        engine: "reference-loader 0.1.0".into(),
        metrics,
    }
}

#[test]
fn backflow_roundtrip_and_match() {
    let c = pokemon();
    let report = pokemon_backflow();
    let json = report.to_json();
    let loaded = backflow_load(&json).expect("回流文件应通过校验");
    assert_eq!(loaded, report);
    assert!(backflow_matches(&loaded, &c), "config_hash 一致应匹配契约");
}

#[test]
fn backflow_rejects_non_metric_key() {
    let mut report = pokemon_backflow();
    report.metrics.insert(
        "not_a_metric".into(),
        MetricPoint {
            mean: 1.0,
            ci95: None,
        },
    );
    let err = backflow_load(&report.to_json()).expect_err("非沙盘指标名应拒");
    assert!(err.to_string().contains("not_a_metric"));
}

#[test]
fn backflow_rejects_invalid_ci_pair() {
    let mut report = pokemon_backflow();
    let metric = sandtable_core::experiment::MetricKey::ALL[0];
    report.metrics.insert(
        metric.name().to_string(),
        MetricPoint {
            mean: 0.5,
            ci95: Some([0.9, 0.1]),
        },
    );
    let err = backflow_load(&report.to_json()).expect_err("CI 下界>上界应拒");
    assert!(err.to_string().contains("CI"));
}

#[test]
fn backflow_rejects_wrong_kind() {
    let mut report = pokemon_backflow();
    report.kind = KIND_CONTRACT.into();
    let err = backflow_load(&report.to_json()).expect_err("回流 kind 不符应拒");
    assert!(err.to_string().contains("kind"));
}

#[test]
fn backflow_match_fails_on_hash_mismatch() {
    let c = pokemon();
    let mut report = pokemon_backflow();
    report.config_hash = "0".repeat(64);
    assert!(!backflow_matches(&report, &c));
}
