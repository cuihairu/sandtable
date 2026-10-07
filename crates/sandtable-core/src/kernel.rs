//! 通用运行时内核(文档 05/07 章):Clock、EventQueue、System trait。
//!
//! 与具体游戏无关的调度骨架,从 Phase 1 切片中抽取:
//! - 离散时钟 [`Clock`]:当前 tick(宏观层 = 天);
//! - 确定性事件队列 [`EventQueue`]:按 (tick, seq) 全序出队;
//! - 系统接口 [`System`]:状态变更入口,只响应声明订阅的事件。
//!
//! 确定性约束(文档 07 章):
//! - 事件按 (tick, seq) 全序出队,`seq` 是入队时的单调序号——同 tick 内
//!   先到先出,与入队时的遍历顺序一致;
//! - 系统内状态遍历必须走有序容器(玩家按 id 升序);
//! - 随机消费必须带键([`crate::rng`]),键与消费顺序解耦。

use std::cmp::Ordering;
use std::collections::BinaryHeap;

/// 离散时钟:当前 tick(宏观层为"天")。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Clock {
    tick: u64,
}

impl Clock {
    pub fn start() -> Self {
        Self { tick: 0 }
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// 推进到 t。tick 单调不减;回拨属于编程错误(debug 断言拦截)。
    pub fn advance_to(&mut self, t: u64) {
        debug_assert!(t >= self.tick, "时钟回拨 {t} < {}", self.tick);
        self.tick = self.tick.max(t);
    }
}

/// 队列内部节点。比较只看 (tick, seq),事件载荷不参与排序。
struct Scheduled<E> {
    tick: u64,
    seq: u64,
    event: E,
}

impl<E> PartialEq for Scheduled<E> {
    fn eq(&self, other: &Self) -> bool {
        self.tick == other.tick && self.seq == other.seq
    }
}

impl<E> Eq for Scheduled<E> {}

impl<E> PartialOrd for Scheduled<E> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl<E> Ord for Scheduled<E> {
    fn cmp(&self, other: &Self) -> Ordering {
        // BinaryHeap 是最大堆:反转比较,pop 得到最小 (tick, seq)
        (other.tick, other.seq).cmp(&(self.tick, self.seq))
    }
}

/// 确定性事件队列:(tick, seq) 全序,同 tick 内按入队序 FIFO。
/// 出队顺序与入队时的调度顺序一一对应,不受堆内部结构影响。
pub struct EventQueue<E> {
    heap: BinaryHeap<Scheduled<E>>,
    next_seq: u64,
}

impl<E> Default for EventQueue<E> {
    fn default() -> Self {
        Self::new()
    }
}

impl<E> EventQueue<E> {
    pub fn new() -> Self {
        Self {
            heap: BinaryHeap::new(),
            next_seq: 0,
        }
    }

    /// 入队:seq 取单调递增序号(同 tick 先到先出的保证)。
    pub fn push(&mut self, tick: u64, event: E) {
        self.heap.push(Scheduled {
            tick,
            seq: self.next_seq,
            event,
        });
        self.next_seq += 1;
    }

    /// 出队:全序最小者。返回 (tick, event);队空返回 None。
    pub fn pop(&mut self) -> Option<(u64, E)> {
        self.heap.pop().map(|s| (s.tick, s.event))
    }

    pub fn len(&self) -> usize {
        self.heap.len()
    }

    pub fn is_empty(&self) -> bool {
        self.heap.is_empty()
    }
}

/// 系统接口(文档 07 章"复杂行为扩展接口"的最小形态):
///
/// ```text
/// System trait
/// ├── name()            系统标识
/// ├── subscribed(event) 只响应声明过的事件
/// ├── update(world, tick, event)  状态变更入口
/// └── 确定性约束        状态遍历必须有序容器;随机消费必须带键
/// ```
///
/// 外部脚本(如 rhai)是"自定义 System 实现"的一种载体,接口先定,载体后选。
pub trait System<W, E> {
    fn name(&self) -> &'static str;

    /// 订阅声明:调度器只把命中的事件派发给该系统。
    fn subscribed(&self, event: &E) -> bool;

    /// 状态变更入口。`tick` 为事件所在时刻(宏观层为天)。
    fn update(&mut self, world: &mut W, tick: u64, event: E);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 事件队列_按tick与入队序全序出队() {
        let mut q = EventQueue::new();
        q.push(2, "late");
        q.push(1, "c");
        q.push(1, "a");
        q.push(1, "b");
        let order: Vec<(u64, &str)> = std::iter::from_fn(|| q.pop()).collect();
        assert_eq!(order, vec![(1, "c"), (1, "a"), (1, "b"), (2, "late")]);
        assert!(q.is_empty());
    }

    #[test]
    fn 事件队列_同tick先到先出() {
        let mut q = EventQueue::new();
        for day in 1..=3u64 {
            q.push(day, format!("close-{day}"));
            q.push(day, format!("open-{day}"));
            q.push(day, format!("player-{day}"));
        }
        // 同 tick 内:入队序 close → open → player(先到先出,与语义无关)
        let first: Vec<String> = (0..3).filter_map(|_| q.pop()).map(|(_, e)| e).collect();
        assert_eq!(first, vec!["close-1", "open-1", "player-1"]);
    }

    #[test]
    fn 时钟_单调推进() {
        let mut c = Clock::start();
        assert_eq!(c.tick(), 0);
        c.advance_to(3);
        c.advance_to(3); // 同 tick 重复推进合法
        c.advance_to(7);
        assert_eq!(c.tick(), 7);
    }

    #[test]
    #[should_panic(expected = "时钟回拨")]
    fn 时钟_回拨拦截() {
        let mut c = Clock::start();
        c.advance_to(5);
        c.advance_to(1);
    }
}
