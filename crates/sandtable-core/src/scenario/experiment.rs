//! 实验文件的 YAML 面(文档 10/12 章):sweep / optimize 节结构 +
//! into_spec 翻译为 [`crate::sweep::SweepSpec`] / [`crate::optimize::OptimSpec`]。

use std::collections::BTreeMap;

use serde::Deserialize;

use crate::optimize::{Direction, Objective, OptimMode, OptimSpec};
use crate::sweep::{ParamRange, SweepMode, SweepSpec, Target, TargetKind};
use crate::Error;

/// 扫描参数范围(sweep/optimize.parameters 的值;文档 12 章的 map 形式:
/// 路径作键)。step 只服务网格扫描,寻优可省略;grid 模式校验拦截缺省 0.0。
#[derive(Debug, Deserialize)]
struct RangeSpec {
    min: f64,
    max: f64,
    #[serde(default)]
    step: f64,
}

/// 约束目标(sweep.targets 的项;metric 用 [`crate::experiment::MetricKey`]
/// 的名字,kind 缺省 hard)。
#[derive(Debug, Deserialize)]
struct TargetYaml {
    metric: String,
    min: Option<f64>,
    max: Option<f64>,
    #[serde(default)]
    kind: TargetKind,
}

/// Experiment 文件的 sweep 节(文档 10/12 章)。parameters 用 map 形式,
/// 键即注册表路径;这里的形状是 YAML 面,经 [`load_experiment_str`]
/// 翻译为 [`SweepSpec`] 后交给扫描引擎。
#[derive(Debug, Deserialize)]
#[serde(default)]
pub(super) struct SweepSection {
    mode: SweepMode,
    /// 复跑数缺省 5(文档 11 章:R 默认 5–10)
    replicates: u32,
    samples: u32,
    parameters: BTreeMap<String, RangeSpec>,
    targets: Vec<TargetYaml>,
}

impl Default for SweepSection {
    fn default() -> Self {
        Self {
            mode: SweepMode::default(),
            replicates: 5,
            samples: 0,
            parameters: BTreeMap::new(),
            targets: Vec::new(),
        }
    }
}

impl SweepSection {
    pub(super) fn into_spec(self) -> Result<SweepSpec, Error> {
        let parameters = self
            .parameters
            .into_iter()
            .map(|(path, r)| ParamRange {
                path,
                min: r.min,
                max: r.max,
                step: r.step,
            })
            .collect();
        let targets = self
            .targets
            .into_iter()
            .map(|t| {
                let metric = crate::experiment::MetricKey::parse(&t.metric).ok_or_else(|| {
                    Error::Config(format!(
                        "sweep.targets: 未知指标 {:?},可选: {:?}",
                        t.metric,
                        crate::experiment::MetricKey::ALL.map(|k| k.name())
                    ))
                })?;
                Ok(Target {
                    metric,
                    min: t.min,
                    max: t.max,
                    kind: t.kind,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        Ok(SweepSpec {
            mode: self.mode,
            parameters,
            replicates: self.replicates,
            samples: self.samples,
            targets,
        })
    }
}

/// Experiment 文件的 optimize 节(文档 12 章自动寻优)。parameters 用 map
/// 形式同 sweep;elite / mutation_* 有缺省值。
#[derive(Debug, Deserialize)]
#[serde(default)]
pub(super) struct OptimSection {
    mode: OptimMode,
    replicates: u32,
    population: u32,
    generations: u32,
    elite: u32,
    mutation_rate: f64,
    mutation_scale: f64,
    parameters: BTreeMap<String, RangeSpec>,
    targets: Vec<TargetYaml>,
    objective: Option<ObjectiveYaml>,
    /// pareto 多目标(mode: pareto;与 objective 互斥,spec.validate 拦)
    objectives: Vec<ObjectiveYaml>,
}

impl Default for OptimSection {
    fn default() -> Self {
        Self {
            mode: OptimMode::default(),
            replicates: 5,
            population: 8,
            generations: 5,
            elite: 2,
            mutation_rate: 0.3,
            mutation_scale: 0.2,
            parameters: BTreeMap::new(),
            targets: Vec::new(),
            objective: None,
            objectives: Vec::new(),
        }
    }
}

/// 排序目标(optimize.objective 的项;direction 缺省 maximize)。
#[derive(Debug, Deserialize)]
struct ObjectiveYaml {
    metric: String,
    #[serde(default)]
    direction: Direction,
}

impl OptimSection {
    pub(super) fn into_spec(self) -> Result<OptimSpec, Error> {
        let parameters = self
            .parameters
            .into_iter()
            .map(|(path, r)| ParamRange {
                path,
                min: r.min,
                max: r.max,
                step: r.step,
            })
            .collect();
        let targets = self
            .targets
            .into_iter()
            .map(|t| {
                let metric = crate::experiment::MetricKey::parse(&t.metric).ok_or_else(|| {
                    Error::Config(format!(
                        "optimize.targets: 未知指标 {:?},可选: {:?}",
                        t.metric,
                        crate::experiment::MetricKey::ALL.map(|k| k.name())
                    ))
                })?;
                Ok(Target {
                    metric,
                    min: t.min,
                    max: t.max,
                    kind: t.kind,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        let objective = match self.objective {
            None => None,
            Some(o) => {
                let metric = crate::experiment::MetricKey::parse(&o.metric).ok_or_else(|| {
                    Error::Config(format!(
                        "optimize.objective: 未知指标 {:?},可选: {:?}",
                        o.metric,
                        crate::experiment::MetricKey::ALL.map(|k| k.name())
                    ))
                })?;
                Some(Objective {
                    metric,
                    direction: o.direction,
                })
            }
        };
        let objectives = self
            .objectives
            .into_iter()
            .map(|o| {
                let metric = crate::experiment::MetricKey::parse(&o.metric).ok_or_else(|| {
                    Error::Config(format!(
                        "optimize.objectives: 未知指标 {:?},可选: {:?}",
                        o.metric,
                        crate::experiment::MetricKey::ALL.map(|k| k.name())
                    ))
                })?;
                Ok(Objective {
                    metric,
                    direction: o.direction,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        Ok(OptimSpec {
            mode: self.mode,
            parameters,
            replicates: self.replicates,
            targets,
            population: self.population,
            generations: self.generations,
            elite: self.elite,
            mutation_rate: self.mutation_rate,
            mutation_scale: self.mutation_scale,
            objective,
            objectives,
        })
    }
}
