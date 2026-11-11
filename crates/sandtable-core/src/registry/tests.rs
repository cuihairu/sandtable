use super::suggest::edit_distance;
use super::*;
use crate::config::SimConfig;
use serde_yaml_ng::from_str;
use serde_yaml_ng::Value;

#[test]
fn registry_paths_unique_and_nonempty() {
    let mut paths: Vec<&str> = all().map(|s| s.path).collect();
    let n = paths.len();
    paths.sort_unstable();
    paths.dedup();
    assert_eq!(paths.len(), n, "注册表路径必须唯一");
    assert!(n >= 40);
}

#[test]
fn unknown_path_suggests_alternatives() {
    let yaml = "schema_version: \"1\"\nmodel:\n  warrior:\n    atk: 100\n";
    let root: Value = from_str(yaml).unwrap();
    let err = check_tree(&root).unwrap_err();
    let msg = err.to_string();
    assert!(msg.contains("model.warrior.atk"), "{msg}");
    assert!(msg.contains("model.warrior.attack"), "{msg}");
}

#[test]
fn valid_tree_passes() {
    let yaml = "schema_version: \"1\"\nscenario:\n  population: 100\ndungeon_stub: 1\n";
    // dungeon_stub 是未知根键,应报错
    let root: Value = from_str(yaml).unwrap();
    assert!(check_tree(&root).is_err());

    let yaml =
        "schema_version: \"1\"\nscenario:\n  population: 100\nmodel:\n  churn:\n    p_base: 0.01\n";
    let root: Value = from_str(yaml).unwrap();
    assert!(check_tree(&root).is_ok());
}

#[test]
fn edit_distance_basics() {
    assert_eq!(edit_distance("abc", "abc"), 0);
    assert_eq!(edit_distance("atk", "attack"), 3);
    assert_eq!(edit_distance("", "ab"), 2);
}

/// 定轨字段已注册进参数表:YAML 入口放行(check_tree),数值通道可读可写
/// (read_numeric / apply_numeric / read_u64_raw)。新增注册路径漏任何一臂
/// 都会在此红(与 get_set_mirror_all_numeric_paths 同纪律)。
#[test]
fn featured_fields_registered_and_routable() {
    let yaml = "schema_version: \"1\"\nmodel:\n  gacha:\n    featured_rate: 0.5\n    featured_guarantee: 1\n";
    let root: Value = from_str(yaml).unwrap();
    check_tree(&root).expect("定轨字段应通过 YAML 入口校验");

    let cfg = SimConfig::default();
    assert_eq!(
        read_numeric(&cfg, "model.gacha.featured_rate").unwrap(),
        0.0
    );
    assert_eq!(
        read_numeric(&cfg, "model.gacha.featured_guarantee").unwrap(),
        0.0
    );
    assert_eq!(
        read_u64_raw(&cfg, "model.gacha.featured_guarantee"),
        Some(0)
    );

    let mut c2 = cfg.clone();
    apply_numeric(&mut c2, "model.gacha.featured_rate", 0.5).unwrap();
    apply_numeric(&mut c2, "model.gacha.featured_guarantee", 1.0).unwrap();
    let g = c2.gacha.as_ref().unwrap();
    assert_eq!(g.featured_rate, 0.5);
    assert_eq!(g.featured_guarantee, 1);
    assert_eq!(read_numeric(&c2, "model.gacha.featured_rate").unwrap(), 0.5);
    assert_eq!(read_u64_raw(&c2, "model.gacha.featured_guarantee"), Some(1));
}

#[test]
fn unsigned_rejects_above_u32_max() {
    let mut cfg = SimConfig::default();
    let err = apply_numeric(&mut cfg, "scenario.population", u32::MAX as f64 + 1.0)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("不能超过 u32 上限"),
        "应拒绝超 u32 上限,实际:{err}"
    );
    let err = apply_numeric(&mut cfg, "scenario.population", -1.0)
        .unwrap_err()
        .to_string();
    assert!(err.contains("不能为负"), "仍应拒绝负数,实际:{err}");
    apply_numeric(&mut cfg, "scenario.population", 0.0).unwrap();
}

#[test]
fn f64_slot_pity_soft_step_uses_finite_nonneg_not_u32_bound() {
    // F64 槽(概率增量)不得套 u32 上界门:超 u32 的值仍应可写(与 YAML
    // validate 的「非负有限」入口一致),但非有限/负值必须拒绝。
    let mut cfg = SimConfig::default();
    apply_numeric(
        &mut cfg,
        "model.gacha.pity_soft_step",
        u32::MAX as f64 + 1.0,
    )
    .unwrap();
    assert_eq!(
        cfg.gacha.as_ref().unwrap().pity_soft_step,
        u32::MAX as f64 + 1.0
    );
    for bad in [f64::NAN, f64::INFINITY, -1.0] {
        let err = apply_numeric(&mut cfg, "model.gacha.pity_soft_step", bad)
            .unwrap_err()
            .to_string();
        assert!(err.contains("非负有限"), "应拒绝 {bad},实际:{err}");
    }
    apply_numeric(&mut cfg, "model.gacha.pity_soft_step", 0.0).unwrap();
}

#[test]
fn f64_slots_reject_nonfinite_and_negative() {
    // L631:非负有限门扩展到全部 f64 槽(此前只 pity_soft_step)。NaN/Inf/
    // 负值经数值通道必须拒绝,不静默写入污染仿真;validate 未覆盖的槽
    // (tier_growth / reward_*_growth / xp_pow)由此获得数值通道防线。
    let bad = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0];
    for path in [
        "model.combat.p_hit",
        "model.combat.p_hit_monster",
        "model.combat.ratio_k",
        "model.dungeon.tier_growth",
        "model.dungeon.reward_gold_growth",
        "model.dungeon.reward_xp_growth",
        "model.behavior.casual.sessions_frac",
        "model.behavior.casual.p_dungeon",
        "model.behavior.casual.p_upgrade",
        "model.behavior.casual.p_training",
        "model.behavior.core.sessions_frac",
        "model.behavior.core.p_dungeon",
        "model.behavior.core.p_upgrade",
        "model.behavior.core.p_training",
        "model.behavior.whale.sessions_frac",
        "model.behavior.whale.p_dungeon",
        "model.behavior.whale.p_upgrade",
        "model.behavior.whale.p_training",
        "model.progression.xp_pow",
        "model.churn.p_base",
        "model.churn.p_stall",
        "model.loot.rate_mult",
        "model.gacha.base_rate",
        "model.gacha.featured_rate",
    ] {
        for v in bad {
            let mut c = SimConfig::default();
            let err = apply_numeric(&mut c, path, v).unwrap_err().to_string();
            assert!(
                err.contains("非负有限"),
                "{path} 应拒绝 {v}(非负有限),实际:{err}"
            );
        }
        // 有效值仍可写(非负有限门不误伤合法值)
        let mut c = SimConfig::default();
        apply_numeric(&mut c, path, 0.5).unwrap();
    }
    // cohort_weights:validate 允许单项为负(只要求每项有限且总和 > 0),故
    // 只拒非有限;负值仍可写(与 validate 同口径,不额外加非负门)。
    for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut c = SimConfig::default();
        let err = apply_numeric(&mut c, "scenario.population_mix.casual", v)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("有限数"),
            "cohort_weights 应拒绝 {v},实际:{err}"
        );
    }
    let mut c = SimConfig::default();
    apply_numeric(&mut c, "scenario.population_mix.casual", -0.5).unwrap();
}

#[test]
fn exact_u64_accepts_above_u32_up_to_safe_integer() {
    // C2 修复回归锁:u64 槽(seed)合法值域到 2^53−1,u32 上界不得误伤;
    // 越 2^53−1 仍走安全整数门(明确拒绝不静默),不是 u32 门。
    let mut cfg = SimConfig::default();
    apply_numeric(&mut cfg, "scenario.seed", 12_345_678_901.0).unwrap();
    assert_eq!(cfg.base_seed, 12_345_678_901);
    let err = apply_numeric(&mut cfg, "scenario.seed", 9_007_199_254_740_993.0)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("2^53−1") && err.contains("不静默舍入"),
        "超安全整数应报 2^53−1 门,实际:{err}"
    );
}

/// read_numeric 与 apply_numeric 互为镜像:全部数值路径读出 → 写回 →
/// 读出不变;非数值路径读必报错。新增注册表路径漏写读臂在此红。
#[test]
fn get_set_mirror_all_numeric_paths() {
    let cfg = crate::config::SimConfig::default();
    for sp in all() {
        match sp.kind {
            ParamKind::U32 | ParamKind::U64 | ParamKind::I64 | ParamKind::F64 | ParamKind::Mix => {
                let v = read_numeric(&cfg, sp.path)
                    .unwrap_or_else(|e| panic!("{}: 读失败 {e}", sp.path));
                let mut c2 = cfg.clone();
                apply_numeric(&mut c2, sp.path, v)
                    .unwrap_or_else(|e| panic!("{}: 写失败 {e}", sp.path));
                let v2 = read_numeric(&c2, sp.path).unwrap();
                assert!(
                    (v - v2).abs() <= 1e-12 * v.abs().max(1.0),
                    "{}: 读 {v} 写后读 {v2}",
                    sp.path
                );
            }
            _ => {
                assert!(
                    read_numeric(&cfg, sp.path).is_err(),
                    "{}: 非数值路径不应可读",
                    sp.path
                );
            }
        }
    }
}

/// WB-03.04:kind 串与 wasm/TS 桥的 ParamKind 字面量同形(serde 小写改名)。
/// 新增枚举臂漏改名或拼错字面量在此红。
#[test]
fn param_kind_serializes_to_lowercase_bridge_strings() {
    let cases = [
        (ParamKind::U32, "u32"),
        (ParamKind::U64, "u64"),
        (ParamKind::I64, "i64"),
        (ParamKind::F64, "f64"),
        (ParamKind::Dur, "dur"),
        (ParamKind::Mix, "mix"),
        (ParamKind::Expr, "expr"),
        (ParamKind::Table, "table"),
    ];
    for (kind, want) in cases {
        let s = serde_json::to_string(&kind).unwrap();
        assert_eq!(s, format!("\"{want}\""), "{kind:?} 应序列化为 \"{want}\"");
    }
}

/// WB-03.04:注册项直出桥接面 = 恰四字段 path/kind/default/desc,内核没有
/// 的可选元信息一概不出场(缺键 ≠ 空串)。
#[test]
fn param_spec_serializes_exactly_four_bridge_fields() {
    let v = serde_json::to_value(lookup("model.combat.p_hit").unwrap()).unwrap();
    let obj = v.as_object().unwrap();
    assert_eq!(obj.len(), 4, "恰四字段,实际:{obj:?}");
    assert_eq!(obj["path"], "model.combat.p_hit");
    assert_eq!(obj["kind"], "f64");
    assert_eq!(obj["default"], "0.85");
    assert!(!obj["desc"].as_str().unwrap().is_empty(), "desc 不为空串");
}

/// lookup 是精确寻址:命中返回注册项本体;未命中(相近拼写 / 大小写 /
/// 空串)一律 None,不做近似或折叠匹配(sweep/override 的寻址前提)。
#[test]
fn lookup_matches_paths_exactly_or_none() {
    let sp = lookup("scenario.duration").unwrap();
    assert_eq!(sp.kind, ParamKind::Dur);
    assert_eq!(sp.default, "30d");
    assert!(lookup("scenario.durations").is_none());
    assert!(lookup("SCENARIO.DURATION").is_none(), "寻址区分大小写");
    assert!(lookup("").is_none());
}

/// all() 与 lookup 互为镜像:全部注册路径可被 lookup 命中且是同一项,
/// 路径前缀恰落在 scenario / model 两节(新增注册项挂错节在此红)。
#[test]
fn all_paths_roundtrip_through_lookup_with_section_prefix() {
    let mut saw_scenario = false;
    let mut saw_model = false;
    for sp in all() {
        assert!(
            sp.path.starts_with("scenario.") || sp.path.starts_with("model."),
            "前缀必须落在两节:{}",
            sp.path
        );
        if sp.path.starts_with("scenario.") {
            saw_scenario = true;
        } else {
            saw_model = true;
        }
        let found = lookup(sp.path).unwrap_or_else(|| panic!("{}: lookup 未命中", sp.path));
        assert_eq!(
            (found.path, found.kind, found.default),
            (sp.path, sp.kind, sp.default)
        );
    }
    assert!(saw_scenario && saw_model, "all() 必须同时含两节");
}
