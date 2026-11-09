//! 命令行参数面(clap derive):全局 Cli / 子命令树 / 通用覆盖项。
//! 只做解析,不碰文件与内核;分发在 main.rs 的 run()。

use std::path::PathBuf;

use clap::{Args, Parser, Subcommand};

use sandtable_core as core;

#[derive(Parser)]
#[command(
    name = "sandtable",
    version,
    about = "配置驱动的游戏系统数字沙盘(Phase 2:YAML 场景配置 + 硬编码最小 RPG)"
)]
pub(crate) struct Cli {
    #[command(subcommand)]
    pub(crate) cmd: Cmd,
}

#[derive(Subcommand)]
pub(crate) enum Cmd {
    /// 运行仿真;SCENARIO 为 YAML 场景文件(缺省用内置默认值)
    Simulate {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
        /// replicate 数(默认 1;增大可平滑指标)
        #[arg(long, default_value_t = 1)]
        replicates: u32,
        /// 输出目录(写 report.json 与 days.csv)
        #[arg(long)]
        out: Option<PathBuf>,
        /// 追加 Parquet 输出(day_stats / power_snapshots / cohort,
        /// 文档 09 章数据契约;与 days.csv 同源,取第 1 个 replicate)。
        /// 需以 --features parquet 构建本 CLI。
        #[cfg(feature = "parquet")]
        #[arg(long)]
        parquet: bool,
    },
    /// A/B 比较:两臂仅 warrior.attack 不同,同种子配对(CRN)
    Compare {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
        #[arg(long, default_value_t = 100)]
        attack_a: i64,
        #[arg(long, default_value_t = 105)]
        attack_b: i64,
        /// 每臂 replicate 数
        #[arg(long, default_value_t = 12)]
        replicates: u32,
        /// 比较指标:retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit | loot_gold_per_player
        #[arg(long, default_value = "retention_d7")]
        metric: String,
        /// 输出目录(写 comparison.json)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数扫描:读实验文件(scenario + model + sweep 三节),候选间并行,
    /// 写候选清单与汇总表(文档 12 章)
    Sweep {
        /// 实验 YAML 文件
        experiment: PathBuf,
        /// 覆盖 sweep.replicates(粗筛可临时调小)
        #[arg(long)]
        replicates: Option<u32>,
        /// 输出目录(candidates.csv / summary.csv / sweep.json,缺省 ./sweep-out)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数寻优:读寻优实验文件(scenario + model + optimize 三节),进化
    /// 算法逐代搜索可行点(文档 12 章自动寻优;代间串行是算法语义)
    Optimize {
        /// 实验 YAML 文件
        experiment: PathBuf,
        /// 覆盖 optimize.replicates(粗筛可临时调小)
        #[arg(long)]
        replicates: Option<u32>,
        /// 输出目录(opt.json / candidates.csv,缺省 ./opt-out)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 随机森林代理:读 sweep 产物训练 / 预测 / 特征重要性(文档 12 章
    /// 自动寻优;只读产物不进仿真路径)
    Surrogate {
        #[command(subcommand)]
        action: SurrogateAction,
    },
    /// 分布检验:均匀 / 加权 / 正态 χ² 检验(文档 24 章 R1/R3;测试台,不进仿真路径)
    Disttest {
        #[command(subcommand)]
        action: DisttestAction,
    },
    /// 生成新场景/实验脚手架:场景 yaml + 基线参数表 + 实验草稿 + README
    /// (模板集中在 cli `scaffold/templates/`,web 向导复用同一模板)
    Scaffold {
        /// 场景名(字母开头,字母/数字/`-`/`_`,长度 ≤ 64)
        name: String,
        /// 输出目录(在其下建 `<name>/` 四件套,缺省当前目录)
        #[arg(long, default_value = ".")]
        out: PathBuf,
    },
    /// 校验场景文件 / 参数组合是否合法
    Validate {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
    },
    /// SQL 事后探索结果数据集(文档 09/10 章;feature duckdb)
    #[cfg(feature = "duckdb")]
    Query {
        /// 输入数据文件(CSV / Parquet);视图名 = 文件名词根
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// SQL 查询(以视图名引用输入)
        #[arg(long)]
        sql: String,
        /// 结果以 CSV 落盘(缺省表格输出 stdout)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 平衡推荐:读 sweep 产物,重算敏感性与单轴推荐区间(文档 14/15 章)
    Recommend {
        /// 实验 YAML 文件(读基线配置)
        experiment: PathBuf,
        /// sweep 输出目录或 sweep.json 路径
        sweep_json: PathBuf,
        /// 敏感性矩阵与推荐以 JSON 落盘(供报告层复用)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// HTML 报告:渲染已落盘产物为单文件 HTML(文档 9/10 章)
    Report {
        /// 结果目录或产物文件(可多个;发现什么渲染什么)
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// 输出 HTML 路径(缺省 ./report.html)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数表导入导出:扁平 CSV ↔ 注册表数值参数(文档 9/10 章)
    Params {
        #[command(subcommand)]
        cmd: ParamsCmd,
    },
    /// 项目打包:场景 / 实验(可选产物)→ 单个 .sandtable 归档(文档 9/10 章)
    Project {
        #[command(subcommand)]
        cmd: ProjectCmd,
    },
    /// Excel 工作流数据包:产物目录 → 多工作表 .xlsx(只读交付,文档 9 章)
    Workbook {
        /// 产物目录(simulate / sweep / compare 的 --out)
        #[arg(required = true)]
        dir: PathBuf,
        /// 输出 .xlsx 路径(缺省 <产物目录>/sandbox.xlsx)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 生成示例场景骨架(默认值 + 注释,可直接编辑运行)
    Init {
        /// 目标路径(缺省 ./scenario.yaml)
        path: Option<PathBuf>,
        /// 已存在时覆盖
        #[arg(long)]
        force: bool,
    },
    /// 分析脚本执行面:显式运行 Python 脚本(scripts/scripting-design.md §5
    /// 执行策略——打印脚本路径与内容哈希,进程隔离 + 超时;`--data` 路径按
    /// 只读输入对待,执行后校验未变。本机 CPython 无真沙箱,安全靠进程
    /// 隔离与执行策略,不靠语言层;本子命令是作者本机自跑自己的脚本,
    /// 不做「运行他人脚本」托管服务)。注意区分:MCP `sandtable_analyze`
    /// 是内置四种分析(ab_compare / daily_aggregate / kpi_summary /
    /// recommend),本子命令是执行用户脚本
    Analyze {
        /// Python 脚本路径
        script: PathBuf,
        /// 只读输入数据路径(文件或目录,可重复;执行前后内容清单一致,
        /// 被改动即失败退出)
        #[arg(long = "data")]
        data: Vec<PathBuf>,
        /// 超时秒数(缺省 600;超时杀进程组,退出码 124)
        #[arg(long, default_value_t = 600)]
        timeout: u64,
        /// 解释器(缺省 python3,回退 python)
        #[arg(long)]
        python: Option<PathBuf>,
        /// 传给脚本的其余参数(`--` 之后,原样转发)
        #[arg(last = true)]
        script_args: Vec<String>,
    },
}

#[derive(Subcommand)]
pub(crate) enum SurrogateAction {
    /// 训练:sweep 产物 → 随机森林模型(model.json)
    Train {
        /// sweep 输出目录或 sweep.json 路径
        sweep_json: PathBuf,
        /// 训练目标指标(retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit | loot_gold_per_player)
        #[arg(long, default_value = "retention_d7")]
        metric: String,
        /// 树数
        #[arg(long, default_value_t = core::surrogate::DEFAULT_TREES)]
        trees: u32,
        /// 最大深度
        #[arg(long, default_value_t = core::surrogate::DEFAULT_MAX_DEPTH)]
        max_depth: u32,
        /// 叶最小样本数
        #[arg(long, default_value_t = core::surrogate::DEFAULT_MIN_SAMPLES_LEAF)]
        min_samples_leaf: usize,
        /// 森林种子(每棵树按序派生,同种子同森林)
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// 模型输出路径(缺省 ./model.json)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 预测:模型 + 参数 JSON 对象 → 指标预测(含全树散布)
    Predict {
        /// 模型文件(train 产物)
        model: PathBuf,
        /// 参数 JSON 对象(键 = 参数路径,须与训练特征集一致)
        #[arg(long)]
        params: String,
    },
    /// 特征重要性:模型 → 参数重要性排序表
    Importance {
        /// 模型文件(train 产物)
        model: PathBuf,
    },
}

#[derive(Subcommand)]
pub(crate) enum DisttestAction {
    /// 均匀检验:[lo, hi) 上均匀采样 → 等宽桶 χ² 检验
    Uniform {
        /// 采样次数
        #[arg(long, default_value_t = 100_000)]
        samples: u64,
        /// 桶数
        #[arg(long, default_value_t = 10)]
        buckets: usize,
        /// 显著性水平 α
        #[arg(long, default_value_t = 0.01)]
        alpha: f64,
        /// 随机种子
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// 下界(含)
        #[arg(long, default_value_t = 0.0)]
        lo: f64,
        /// 上界(不含)
        #[arg(long, default_value_t = 1.0)]
        hi: f64,
    },
    /// 加权检验:读场景 YAML 的掉落表 → 按权重采样 → χ² 检验
    Weighted {
        /// YAML 场景文件(含 model.loot.tables)
        scenario: PathBuf,
        /// 表名
        table: String,
        /// 采样次数
        #[arg(long, default_value_t = 100_000)]
        samples: u64,
        /// 显著性水平 α
        #[arg(long, default_value_t = 0.01)]
        alpha: f64,
        /// 随机种子
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
    /// 正态检验:Normal(μ, σ) 采样 → [μ±k·σ] 均分桶 χ² 检验(尾部并入首尾桶)
    Normal {
        /// 采样次数
        #[arg(long, default_value_t = 100_000)]
        samples: u64,
        /// 桶数
        #[arg(long, default_value_t = 20)]
        buckets: usize,
        /// 半宽(σ 的倍数,区间 [μ−k·σ, μ+k·σ])
        #[arg(long, default_value_t = 3.0)]
        spread: f64,
        /// 均值 μ
        #[arg(long, default_value_t = 0.0)]
        mu: f64,
        /// 标准差 σ
        #[arg(long, default_value_t = 1.0)]
        sigma: f64,
        /// 显著性水平 α
        #[arg(long, default_value_t = 0.01)]
        alpha: f64,
        /// 随机种子
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
}

#[derive(Subcommand)]
pub(crate) enum ParamsCmd {
    /// 导出全量数值参数模板(path,value)
    Export {
        /// 基线场景(缺省默认配置)
        scenario: Option<PathBuf>,
        /// 输出路径(缺省 ./params.csv)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 导入参数表:逐行覆写基线配置并校验(坏行逐行报,退出码 2)
    Import {
        /// 参数表 CSV(path,value)
        csv: PathBuf,
        /// 基线场景(缺省默认配置)
        scenario: Option<PathBuf>,
        /// 合并结果落盘为场景 YAML(可直接 simulate)
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
pub(crate) enum ProjectCmd {
    /// 打包项目目录为 .sandtable 归档(scenarios/ experiments/ results/ 一层)
    Pack {
        /// 项目目录
        dir: PathBuf,
        /// 输出归档路径(缺省 <目录名>.sandtable)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 校验并展开归档(目标目录须不存在或为空,不覆盖既有文件)
    Unpack {
        /// .sandtable 归档
        archive: PathBuf,
        /// 输出目录(缺省归档去扩展名)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 只校验归档(manifest、哈希、路径纪律、配置加载),不落盘
    Check {
        /// .sandtable 归档
        archive: PathBuf,
    },
}

#[derive(Args)]
pub(crate) struct Overrides {
    /// 玩家数(scenario.population)
    #[arg(long)]
    pub(crate) players: Option<u32>,
    /// 天数(scenario.duration)
    #[arg(long)]
    pub(crate) days: Option<u32>,
    /// 基础种子(scenario.seed)
    #[arg(long)]
    pub(crate) seed: Option<u64>,
    /// 初始攻击力(model.warrior.attack)
    #[arg(long)]
    pub(crate) init_attack: Option<i64>,
}

impl Overrides {
    pub(crate) fn apply(&self, cfg: &mut core::config::SimConfig) {
        if let Some(v) = self.players {
            cfg.players = v;
        }
        if let Some(v) = self.days {
            cfg.days = v;
        }
        if let Some(v) = self.seed {
            cfg.base_seed = v;
        }
        if let Some(v) = self.init_attack {
            cfg.warrior.attack = v;
        }
    }
}
