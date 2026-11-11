//! 共享数值上界与玩家分群(I-002 / I-003 / I-004 / I-011 审计口径):
//! 五壳层共用同一道硬门,超限返回结构化 ConfigError 而非 OOM / 死循环。

use serde::{Deserialize, Serialize};

/// 玩家分群。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cohort {
    Casual,
    Core,
    Whale,
}

pub const COHORT_COUNT: usize = 3;

/// 仿真规模预算(I-002 / ST-AUD-02):单次仿真的 `players × days` 上界。
/// 五壳层共用同一常量——Web 已用 40 万作为 players×days 预算,本仓把该
/// 口径上提到 core,让 CLI / 桌面 / MCP / Python / WASM 在任何壳层都先
/// 过同一道硬门,避免单壳层漏配(恶意 YAML `population: 4294967295` 或
/// `duration: "4294967295d"` 会预分配 4e9 Actor + 32GB Vec,进程 abort)。
/// 桌面 / CLI 定位大型实验,但「规模 × 输入上限」这道红线仍须显式,
/// 超限返回结构化 ConfigError 而非 OOM。
pub const MAX_SIM_SCALE: u64 = 400_000;

/// 单维上界(I-002):players / days 各自的上限。40 万预算下取 `MAX_SIM_SCALE`
/// 作为单维上界(另一维为 1 时即达预算),防 32 位溢出预分配与数十亿次空转。
pub const MAX_SIM_DIM: u32 = MAX_SIM_SCALE as u32;

/// 抽卡最小基础命中率(I-003 / ST-AUD-03):base_rate 无下限时,`1e-300`
/// 这类合法值使 `pull_until_hit` 期望 1e300 抽,实质死循环。设下限保证
/// 单抽会话在有限期望步内终止(软/硬保底可再提前)。取 1e-4(期望 1 万抽),
/// 与真实卡池量级(2% 起)相比已极度保守,仍杜绝天文数字循环。
pub const MIN_GACHA_BASE_RATE: f64 = 1e-4;

/// 抽卡会话最大抽数(I-003 / ST-AUD-03):防御纵深,即使 `pity_hard`/软保底
/// 都因配置异常失效,单会话也不会无限循环。超出返回结构化错误。
pub const MAX_GACHA_PULLS: u64 = 1_000_000;

/// 无定轨 featured 层的组合概率下界(2026-11-06 审核发现,2026-11-07 复审
/// 收紧):目标判定退化为每 5★ 独立几何(概率 `featured_rate`),5★ 本身
/// 又是每抽独立几何(概率 `base_rate`)。无保底时抽到所定目标的总概率 =
/// `base_rate × featured_rate`。两个各取 `MIN_GACHA_BASE_RATE=1e-4` 时乘积
/// `1e-8`,期望 `1e8` 抽,远超 `MAX_GACHA_PULLS=1e6`。
///
/// 下限取 `100 / MAX_GACHA_PULLS = 1e-4`,这是**尾部界**而不只是期望界:
/// 过检配置单会话触限概率 ≤ e^{-100}(≈3.7e-44),使 sim 层的会话超限处置
/// (记为该玩家未命中并继续,见 `sim.rs`)保持其注释声明的「运行时不可能
/// 路径」语义——期望口径的下限(如旧值 1e-6)在乘积恰为下限时触限概率
/// 高达 1/e,不满足该前提。与真实卡池(≥0.375×≥0.02=7.5e-3)相比仍极度
/// 保守。本常量是统一守卫(validate 中「会话目标命中期望数下界 ≥ 100」)
/// 在无定轨 + 无硬保底特例下的乘积形式,守卫本身按一般形式实现。
pub const MIN_GACHA_TARGET_RATE: f64 = 1e-4;

/// 扫描/寻优 replicates 核心上界(I-011 / ST-AUD-11):壳层可再收紧
/// (Web 64、MCP 4096、桌面 64),core 统一兜底避免 u32::MAX 级分配。
/// 取 10_000——真实实验量级(2–400)的 25 倍余量,仍杜绝 4e9 级分配。
pub const MAX_SWEEP_REPLICATES: u32 = 10_000;

/// 经济面 i64 统一上界(ST-AUD-04 / I-004):远超当前 400k×64 仿真规模
/// 下的单次产出,但足以避免乘以 whale 倍率后溢出或 `as u64` 回绕。
pub const MAX_ECONOMY_VALUE: i64 = 1_000_000_000_000_000;

/// 每日会话数上界(2026-11-12 审核修复批 P1):`sessions_int` 为 u32 且
/// 此前无上界,合法 YAML 即可写 4e9——`players × days` 预算
/// (`MAX_SIM_SCALE`)只约束「人数 × 天数」,不约束「每人每天的工作量」,
/// 单次运行实质死循环。战斗键 `battle_index × ROUND_STRIDE(64)` 也在
/// 千万级会话下回绕破坏 CRN。取 1e6——对齐 `MAX_GACHA_PULLS` 的
/// 「单玩家单日循环上界」口径,默认值 1(casual)的 10^6 倍余量。
pub const MAX_SESSIONS_PER_DAY: u32 = 1_000_000;

impl Cohort {
    pub const ALL: [Cohort; COHORT_COUNT] = [Cohort::Casual, Cohort::Core, Cohort::Whale];
    pub fn index(self) -> usize {
        match self {
            Cohort::Casual => 0,
            Cohort::Core => 1,
            Cohort::Whale => 2,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Cohort::Casual => "casual",
            Cohort::Core => "core",
            Cohort::Whale => "whale",
        }
    }
    pub fn from_name(s: &str) -> Option<Self> {
        Some(match s {
            "casual" => Cohort::Casual,
            "core" => Cohort::Core,
            "whale" => Cohort::Whale,
            _ => return None,
        })
    }
}
