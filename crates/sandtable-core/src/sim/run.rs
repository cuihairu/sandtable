//! 执行循环入口:run / run_with_day_hook / DayHook 钩子 + 内部 run_impl 驱动,
//! 以及按日滚动调度的 schedule_day。
use crate::config::SimConfig;
use crate::kernel::{Clock, EventQueue};
use crate::metrics::RunMetrics;
use crate::world::World;

use super::event::SimEvent;
use super::system::build_systems;
/// 运行第 `replicate` 个 replicate(0 起),返回该次运行的完整指标。
pub fn run(cfg: &SimConfig, replicate: u32) -> RunMetrics {
    run_impl(cfg, replicate, None)
}

/// 日粒度批量观测钩子(脚本层阶段 3,实测依据 scripts/scripting-perf-report.md):
/// 每日 [`SimEvent::DayClose`] 记账完成后调用一次,拿到当天日结的世界状态。
/// **只读契约**——实现不得改动 World,同配置同 seed 结果与 [`run`] 逐位一致
/// (测试锁死)。粒度红线(设计稿 §4):本通道 = 每天一次,事件级 Python
/// 回调仍禁止(10⁷ 事件 × ns 级调用即超基线,实测报告有数据)。
pub trait DayHook {
    fn on_day(&mut self, world: &World, day: u32);
}

/// 带日观测钩子的运行:除逐日回调外,语义与 [`run`] 完全一致。
pub fn run_with_day_hook(cfg: &SimConfig, replicate: u32, hook: &mut dyn DayHook) -> RunMetrics {
    run_impl(cfg, replicate, Some(hook))
}

fn run_impl(cfg: &SimConfig, replicate: u32, mut hook: Option<&mut dyn DayHook>) -> RunMetrics {
    let seed = crate::config::replicate_seed(cfg.base_seed, replicate);
    // 公式槽在 run 开始编译一次(文档 07 章加载期编译);非法公式已在
    // config::validate 拦截,这里直接假定可编译。
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .expect("formulas.xp_needed 编译失败:SimConfig 未经 config::validate");
    // 分群派生也用 replicate 种子:replicate 间独立,同 r 的 A/B 臂分群相同
    let mut run_cfg = cfg.clone();
    run_cfg.base_seed = seed;
    let mut world = World::new(run_cfg);

    // 按日滚动调度(审核整改 P1:一次性排入 players×days 事件会让队列
    // 随规模线性膨胀,10 万人 × 90 天 ≈ 900 万事件)。第 1 日先入队,
    // 此后每个 DayClose{d} 处理完再排入 d+1 日。出队序与一次性预排逐位
    // 一致:(tick, seq) 全序下,同 tick 内 seq 升序(DayOpen → 玩家日 →
    // DayClose 的入队序不变),跨 tick 由 tick 定序,滚动入队不改变任何
    // 相对次序。抽卡会话排在 tick 0(Clock 起点,先于第 1 天):开号
    // 行为,不属于任何一天。
    let mut queue = EventQueue::new();
    if cfg.gacha.is_some() {
        for id in 0..u64::from(cfg.players) {
            queue.push(0, SimEvent::GachaRoll { actor_id: id });
        }
    }
    schedule_day(&mut queue, 1, cfg.players);

    let mut systems = build_systems(cfg, seed, &xp_needed_formula);

    let mut clock = Clock::start();
    while let Some((tick, event)) = queue.pop() {
        clock.advance_to(tick);
        // MVP 中每类事件恰好有一个订阅系统:命中即派发
        for sys in &mut systems {
            if sys.subscribed(&event) {
                sys.update(&mut world, tick, event);
                break;
            }
        }
        // 日粒度观测钩子:DayClose 系统记账完成后的世界状态,只读(阶段 3;
        // None 时零分支成本路径外的纯检查,黄金快照不受影响)
        if let (SimEvent::DayClose { day }, Some(h)) = (event, hook.as_deref_mut()) {
            h.on_day(&world, day);
        }
        // 滚动调度:当日关闭后排队次日(最后一天不再排,队列自然排空)
        if let SimEvent::DayClose { day } = event {
            if day < cfg.days {
                schedule_day(&mut queue, day + 1, cfg.players);
            }
        }
    }

    // finish 的 config_hash 输入必须是外层 cfg(base_seed 未被 replicate 覆盖)
    world.agg.finish(cfg, replicate, seed)
}

/// 排入一个日粒度的事件组(DayOpen → 全部玩家日 → DayClose;同 tick 内
/// 按入队 seq 定序)。滚动调度用,见 run_impl 注释。
fn schedule_day(queue: &mut EventQueue<SimEvent>, day: u32, players: u32) {
    queue.push(u64::from(day), SimEvent::DayOpen { day });
    for id in 0..u64::from(players) {
        queue.push(u64::from(day), SimEvent::PlayerDay { actor_id: id, day });
    }
    queue.push(u64::from(day), SimEvent::DayClose { day });
}
