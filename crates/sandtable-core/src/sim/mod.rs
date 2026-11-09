//! 执行循环(文档 05 章分层时间模型的宏观层):以"天"为粒度的离散事件推进,
//! 由通用内核([`crate::kernel`] 的 Clock / EventQueue / System)驱动。
//!
//! 事件调度(与 Phase 1 的双层 for 循环逐位对应):第 d 天依次入队
//! `DayOpen(d)` → 每个玩家一个 `PlayerDay`(id 升序)→ `DayClose(d)`;
//! 事件按 (tick, seq) 全序出队,出队序即入队序——重构不改行为,
//! 黄金快照逐字节一致是验收线。
//!
//! 每个玩家每天的事件序列:
//! 会话数抽样 → 逐会话动作选择(副本 / 强化 / 闲逛)→ 战斗解析结算 →
//! 奖励入账与成长 → 日结战力 → 停滞计数 → 流失伯努利。
//!
//! 确定性:玩家按 id 升序处理(顺序不影响结果——随机数全按键派生,
//! 这里只是让执行序固定);第 r 个 replicate 的种子为 base_seed + r,
//! 分群也按 replicate 种子派生,replicate 间独立,A/B 臂间同键可比(CRN)。

mod event;
mod registry;
mod run;
mod system;

pub use event::EventKind;
pub use registry::system_registry;
pub use run::{run, run_with_day_hook, DayHook};

#[cfg(test)]
mod tests;
