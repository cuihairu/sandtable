//! 仿真事件类型(宏观层):`SimEvent` 三类事件 + 调度面快照用的 `EventKind`。
//! 事件清单与订阅面同源登记:新增 SimEvent 变体必须同步补 EventKind 与
//! probe_event 的 match 臂,否则编译失败——清单漏登记不可能静默。
/// 仿真事件(宏观层)。三类事件各有唯一订阅系统。
#[derive(Debug, Clone, Copy)]
pub(super) enum SimEvent {
    /// 日初:记录期初存活数(当日流失不影响当日 churn_rate 分母)
    DayOpen { day: u32 },
    /// 玩家日:一个玩家一天的全部行为与状态变更
    PlayerDay { actor_id: u64, day: u32 },
    /// 日结:存量 G(d)、Power 观测、快照日分布
    DayClose { day: u32 },
    /// 抽卡会话(文档 24 章 R2):开号"出到即止",tick 0(第 1 天之前)
    GachaRoll { actor_id: u64 },
}

/// 事件种类(调度面快照用)。[`probe_event`] 的 match **无通配符**:
/// 新增 SimEvent 变体必须在此补臂,否则编译失败——事件清单漏登记不可能静默。
#[derive(Debug, Clone, Copy)]
pub enum EventKind {
    DayOpen,
    PlayerDay,
    DayClose,
    GachaRoll,
}

impl EventKind {
    /// 图与日志展示名(与 SimEvent 变体同名)。
    pub fn name(self) -> &'static str {
        match self {
            EventKind::DayOpen => "DayOpen",
            EventKind::PlayerDay => "PlayerDay",
            EventKind::DayClose => "DayClose",
            EventKind::GachaRoll => "GachaRoll",
        }
    }
}

pub(super) const ALL_EVENT_KINDS: &[EventKind] = &[
    EventKind::DayOpen,
    EventKind::PlayerDay,
    EventKind::DayClose,
    EventKind::GachaRoll,
];

pub(super) fn probe_event(kind: EventKind) -> SimEvent {
    match kind {
        EventKind::DayOpen => SimEvent::DayOpen { day: 0 },
        EventKind::PlayerDay => SimEvent::PlayerDay {
            actor_id: 0,
            day: 0,
        },
        EventKind::DayClose => SimEvent::DayClose { day: 0 },
        EventKind::GachaRoll => SimEvent::GachaRoll { actor_id: 0 },
    }
}
