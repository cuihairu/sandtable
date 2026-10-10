//! 随机森林代理(文档 12 章自动寻优增量裁定,2026-10-10)。
//!
//! 裁定要点:GP 需稠密矩阵求逆 + 核超参黑箱;随机森林纯离散树、无线性代数
//! 依赖,wasm32 兼容;bootstrap 复用 SplitMix64 键派生流,与确定性纪律同构;
//! 特征重要性直接回答"哪些参数驱动指标",与"字典序非加权"的可解释性同源。
//! 典型数据 36–152 候选,森林足够。
//!
//! 红线:代理**只读 sweep 产物、不进仿真路径**(文档 09 章)。
//!
//! 确定性:第 t 棵树用 `SweepRng::new(seed ^ t·0x9E37_79B9_7F4A_7C15)`
//! 做 bootstrap 采样,同种子同森林,线程数无关;回归树不采特征子空间
//! (全特征找分裂,bootstrap 已供多样性),分裂点取相邻不同值中点、
//! 最小加权方差、严格 first-found 破平——全链无浮点排序歧义(`total_cmp`)。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::experiment::MetricKey;
use crate::sweep::{CandidateResult, CandidateStatus, SweepRng};
use crate::Error;

/// 训练样本:一行特征 + 目标值。
type TrainingRow = (Vec<f64>, f64);
/// 特征名表 + 训练行。
type TrainingData = (Vec<String>, Vec<TrainingRow>);

/// 默认树数(小样本 36–152 候选足够)。
pub const DEFAULT_TREES: u32 = 50;
/// 默认最大深度。
pub const DEFAULT_MAX_DEPTH: u32 = 8;
/// 默认叶最小样本数。
pub const DEFAULT_MIN_SAMPLES_LEAF: usize = 2;

/// 森林超参(显式落模型文件,不藏运行期默认)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurrogateSpec {
    /// 树数
    pub trees: u32,
    /// 最大深度
    pub max_depth: u32,
    /// 叶节点最小样本数
    pub min_samples_leaf: usize,
    /// 森林种子:第 t 棵树用 seed ^ t·0x9E37_79B9_7F4A_7C15 派生
    pub seed: u64,
}

impl SurrogateSpec {
    pub fn new(seed: u64) -> Self {
        Self {
            trees: DEFAULT_TREES,
            max_depth: DEFAULT_MAX_DEPTH,
            min_samples_leaf: DEFAULT_MIN_SAMPLES_LEAF,
            seed,
        }
    }

    pub fn validate(&self) -> Result<(), Error> {
        if self.trees < 1 {
            return Err(Error::Config("surrogate.trees 必须 ≥ 1".into()));
        }
        if self.max_depth < 1 {
            return Err(Error::Config("surrogate.max_depth 必须 ≥ 1".into()));
        }
        if self.min_samples_leaf < 1 {
            return Err(Error::Config("surrogate.min_samples_leaf 必须 ≥ 1".into()));
        }
        Ok(())
    }
}

/// 回归树节点:叶存均值,分裂点存(特征下标,阈值),左 = 值 ≤ 阈值。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreeNode {
    Leaf {
        value: f64,
    },
    Split {
        feature: usize,
        threshold: f64,
        left: Box<TreeNode>,
        right: Box<TreeNode>,
    },
}

/// 随机森林代理:metric 的预测器 + 特征重要性。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RandomForest {
    /// 训练目标指标(snake_case 名,回读提示用)
    pub metric: String,
    /// 特征名(参数路径,与训练行 / predict_row 列序一致)
    pub features: Vec<String>,
    /// 超参(训练时用)
    pub spec: SurrogateSpec,
    /// 森林
    pub forest: Vec<TreeNode>,
    /// 不纯度重要性(分裂方差削减,归一到和 1;与 features 同序)
    pub importance: Vec<f64>,
}

impl RandomForest {
    /// 从 sweep 产物拟合:过滤配置错误候选 → 训练矩阵 → 森林。
    pub fn fit(
        results: &[CandidateResult],
        metric: MetricKey,
        spec: SurrogateSpec,
    ) -> Result<Self, Error> {
        spec.validate()?;
        let (feature_names, rows) = training_rows(results, metric)?;
        Self::train(metric.name(), feature_names, rows, spec)
    }

    /// 纯矩阵训练入口(测试与复用;`fit` 是 sweep 产物的便捷封装)。
    pub fn train(
        metric: &str,
        feature_names: Vec<String>,
        rows: Vec<TrainingRow>,
        spec: SurrogateSpec,
    ) -> Result<Self, Error> {
        spec.validate()?;
        if rows.is_empty() {
            return Err(Error::Config("surrogate: 训练样本为空".into()));
        }
        let width = rows[0].0.len();
        if width == 0 {
            return Err(Error::Config("surrogate: 特征数为 0".into()));
        }
        if feature_names.len() != width {
            return Err(Error::Config(format!(
                "surrogate: 特征名 {} 个,数据 {} 维,不一致",
                feature_names.len(),
                width
            )));
        }
        if rows.iter().any(|r| r.0.len() != width) {
            return Err(Error::Config("surrogate: 训练行特征维数不一致".into()));
        }
        let mut importance = vec![0.0; width];
        let mut forest = Vec::with_capacity(spec.trees as usize);
        for t in 0..spec.trees {
            let mut rng = SweepRng::new(spec.seed ^ (t as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
            let sample: Vec<(Vec<f64>, f64)> = (0..rows.len())
                .map(|_| {
                    let i = (rng.next_u64() % rows.len() as u64) as usize;
                    rows[i].clone()
                })
                .collect();
            forest.push(build_tree(&sample, 0, &spec, &mut importance));
        }
        // 方差削减归一(全零 = 无任何分裂,如实保持 0)
        let total: f64 = importance.iter().sum();
        if total > 0.0 {
            for v in &mut importance {
                *v /= total;
            }
        }
        Ok(Self {
            metric: metric.to_string(),
            features: feature_names,
            spec,
            forest,
            importance,
        })
    }

    /// 预测:参数按模型特征序组装后取全树均值。
    pub fn predict(&self, params: &BTreeMap<String, f64>) -> Result<f64, Error> {
        let row = self.resolve(params)?;
        Ok(self.predict_row(&row))
    }

    /// 单行预测(row 与 [`Self::features`] 同序;先验 API,快于逐候选查表)。
    pub fn predict_row(&self, row: &[f64]) -> f64 {
        let sum: f64 = self.forest.iter().map(|t| eval_tree(t, row)).sum();
        sum / self.forest.len() as f64
    }

    /// 逐树预测(森林分歧度 = 这组值的散布)。
    pub fn tree_values(&self, row: &[f64]) -> Vec<f64> {
        self.forest.iter().map(|t| eval_tree(t, row)).collect()
    }

    fn resolve(&self, params: &BTreeMap<String, f64>) -> Result<Vec<f64>, Error> {
        self.features
            .iter()
            .map(|f| {
                params
                    .get(f)
                    .copied()
                    .ok_or_else(|| Error::Config(format!("surrogate: 缺少特征 {}", f)))
            })
            .collect()
    }
}

/// sweep 产物 → 训练矩阵:只收 Ok 候选(配置错误的不进代理);
/// 参数集必须一致,目标指标必须每候选都有。
fn training_rows(results: &[CandidateResult], metric: MetricKey) -> Result<TrainingData, Error> {
    let ok: Vec<&CandidateResult> = results
        .iter()
        .filter(|r| matches!(r.status, CandidateStatus::Ok))
        .collect();
    if ok.is_empty() {
        return Err(Error::Config("surrogate: 无有效候选(全部配置错误)".into()));
    }
    let features: Vec<String> = ok[0].values.keys().cloned().collect();
    if features.is_empty() {
        return Err(Error::Config("surrogate: 候选参数为空".into()));
    }
    let mut rows = Vec::with_capacity(ok.len());
    for r in ok {
        let mismatch =
            r.values.len() != features.len() || features.iter().any(|f| !r.values.contains_key(f));
        if mismatch {
            return Err(Error::Config(
                "surrogate: 候选参数集不一致,无法组训练矩阵".into(),
            ));
        }
        let y = r
            .metric_stats
            .iter()
            .find(|(k, _)| *k == metric)
            .map(|(_, s)| s.mean)
            .ok_or_else(|| Error::Config(format!("surrogate: 候选缺指标 {}", metric.name())))?;
        rows.push((features.iter().map(|f| r.values[f]).collect(), y));
    }
    Ok((features, rows))
}

/// CART 回归树:停留条件(达限深 / 样本不足以再分 / 目标常数 / 无有效分裂)
/// 下落叶(均值);否则全特征扫相邻不同值中点,取方差削减最大的分裂。
fn build_tree(
    rows: &[TrainingRow],
    depth: u32,
    spec: &SurrogateSpec,
    importance: &mut [f64],
) -> TreeNode {
    let n = rows.len();
    let first_y = rows[0].1;
    let constant = rows.iter().all(|(_, y)| *y == first_y);
    if depth >= spec.max_depth || n < 2 * spec.min_samples_leaf || constant {
        return leaf_of(rows);
    }
    match best_split(rows, spec.min_samples_leaf, importance) {
        Some((feature, threshold)) => {
            let (left, right) = partition(rows, feature, threshold);
            TreeNode::Split {
                feature,
                threshold,
                left: Box::new(build_tree(&left, depth + 1, spec, importance)),
                right: Box::new(build_tree(&right, depth + 1, spec, importance)),
            }
        }
        None => leaf_of(rows),
    }
}

fn leaf_of(rows: &[TrainingRow]) -> TreeNode {
    let sum: f64 = rows.iter().map(|(_, y)| y).sum();
    TreeNode::Leaf {
        value: sum / rows.len() as f64,
    }
}

fn partition(
    rows: &[TrainingRow],
    feature: usize,
    threshold: f64,
) -> (Vec<TrainingRow>, Vec<TrainingRow>) {
    let mut left = Vec::new();
    let mut right = Vec::new();
    for r in rows {
        if r.0[feature] <= threshold {
            left.push(r.clone());
        } else {
            right.push(r.clone());
        }
    }
    (left, right)
}

/// 全特征扫描:按特征排序后,只在相邻**不同**值的中点试分裂(两侧各满足
/// min_samples_leaf),最小化 SSE 左 + SSE 右(前缀和 O(n) 算);方差削减
/// 累进 importance(不纯度重要性),严格大于破平 → 先到先得,确定。
fn best_split(
    rows: &[TrainingRow],
    min_leaf: usize,
    importance: &mut [f64],
) -> Option<(usize, f64)> {
    let n = rows.len();
    let n_features = rows[0].0.len();
    let (total_sum, total_sumsq) = rows
        .iter()
        .fold((0.0, 0.0), |(s, q), (_, y)| (s + y, q + y * y));
    let parent = total_sumsq - total_sum * total_sum / n as f64;
    let mut best: Option<(usize, f64, f64)> = None;
    let mut best_red = 0.0;
    for f in 0..n_features {
        let mut idx: Vec<usize> = (0..n).collect();
        idx.sort_by(|&i, &j| rows[i].0[f].total_cmp(&rows[j].0[f]));
        let (mut sum_l, mut sumsq_l) = (0.0, 0.0);
        for w in 0..n - 1 {
            let i = idx[w];
            let y = rows[i].1;
            sum_l += y;
            sumsq_l += y * y;
            let cnt_l = w + 1;
            if cnt_l < min_leaf || n - cnt_l < min_leaf {
                continue;
            }
            let (x_here, x_next) = (rows[i].0[f], rows[idx[w + 1]].0[f]);
            if x_here == x_next {
                continue;
            }
            let (sum_r, sumsq_r) = (total_sum - sum_l, total_sumsq - sumsq_l);
            let sse_l = sumsq_l - sum_l * sum_l / cnt_l as f64;
            let sse_r = sumsq_r - sum_r * sum_r / (n - cnt_l) as f64;
            let reduction = parent - sse_l - sse_r;
            if reduction > best_red {
                best_red = reduction;
                best = Some((f, (x_here + x_next) / 2.0, reduction));
            }
        }
    }
    match best {
        Some((f, threshold, red)) => {
            importance[f] += red;
            Some((f, threshold))
        }
        None => None,
    }
}

fn eval_tree(node: &TreeNode, row: &[f64]) -> f64 {
    match node {
        TreeNode::Leaf { value } => *value,
        TreeNode::Split {
            feature,
            threshold,
            left,
            right,
        } => {
            let next = if row[*feature] <= *threshold {
                left
            } else {
                right
            };
            eval_tree(next, row)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experiment::SampleStats;

    /// 2 特征合成数据:y = 2a + 0.5b(带分段结构让树有事可做)。
    fn synth_rows() -> Vec<(Vec<f64>, f64)> {
        let mut rows = Vec::new();
        for a in [10.0, 30.0, 50.0, 70.0, 90.0, 110.0] {
            for b in [1.0, 5.0, 9.0] {
                let y = 2.0 * a + 0.5 * b;
                rows.push((vec![a, b], y));
            }
        }
        rows
    }

    fn stats(mean: f64) -> SampleStats {
        SampleStats {
            n: 3,
            mean,
            sd: 0.0,
            ci95_lo: mean,
            ci95_hi: mean,
        }
    }

    fn cand(params: &[(&str, f64)], win_rate: f64) -> CandidateResult {
        CandidateResult {
            values: params.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
            status: CandidateStatus::Ok,
            metric_stats: vec![(MetricKey::WinRate, stats(win_rate))],
            target_outcomes: Vec::new(),
        }
    }

    #[test]
    fn 森林同种子逐位一致() {
        let rows = synth_rows();
        let a = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            rows.clone(),
            SurrogateSpec::new(7),
        )
        .unwrap();
        let b = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            rows,
            SurrogateSpec::new(7),
        )
        .unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn 森林换种子不同() {
        let rows = synth_rows();
        let a = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            rows.clone(),
            SurrogateSpec::new(7),
        )
        .unwrap();
        let b = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            rows,
            SurrogateSpec::new(8),
        )
        .unwrap();
        assert_ne!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn 线性关系拟合与重要性主导() {
        let rows = synth_rows();
        let model = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            rows.clone(),
            SurrogateSpec::new(11),
        )
        .unwrap();
        // 训练内 MAE 远小于目标值域(≈200)
        let mae: f64 = rows
            .iter()
            .map(|(x, y)| (model.predict_row(x) - y).abs())
            .sum::<f64>()
            / rows.len() as f64;
        assert!(mae < 20.0, "训练内 MAE {} 过大", mae);
        // 主驱动特征 a 的重要性压过 b
        assert!(
            model.importance[0] > model.importance[1],
            "importance = {:?}",
            model.importance
        );
        assert!((model.importance.iter().sum::<f64>() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn 常数目标退化为单叶() {
        let rows: Vec<(Vec<f64>, f64)> = (0..8).map(|i| (vec![i as f64], 7.0)).collect();
        let model =
            RandomForest::train("win_rate", vec!["x".into()], rows, SurrogateSpec::new(3)).unwrap();
        for tree in &model.forest {
            assert!(matches!(tree, TreeNode::Leaf { value } if (*value - 7.0).abs() < 1e-12));
        }
        assert_eq!(model.predict_row(&[3.0]), 7.0);
        assert!(model.importance.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn 训练行过滤配置错误并校验一致性() {
        let results = vec![
            cand(&[("a", 1.0), ("b", 2.0)], 0.5),
            CandidateResult {
                values: cand(&[("a", 9.0), ("b", 9.0)], 0.0).values,
                status: CandidateStatus::ConfigError("越界".into()),
                metric_stats: Vec::new(),
                target_outcomes: Vec::new(),
            },
            cand(&[("a", 2.0), ("b", 3.0)], 0.6),
        ];
        let (features, rows) = training_rows(&results, MetricKey::WinRate).unwrap();
        assert_eq!(features, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], (vec![1.0, 2.0], 0.5));

        // 参数集不一致 → 报错
        let bad = vec![
            cand(&[("a", 1.0)], 0.5),
            cand(&[("a", 1.0), ("b", 2.0)], 0.6),
        ];
        assert!(training_rows(&bad, MetricKey::WinRate).is_err());
        // 缺指标 → 报错
        let no_metric = vec![CandidateResult {
            values: cand(&[("a", 1.0)], 0.0).values,
            status: CandidateStatus::Ok,
            metric_stats: vec![(MetricKey::ChurnRate, stats(0.1))],
            target_outcomes: Vec::new(),
        }];
        assert!(training_rows(&no_metric, MetricKey::WinRate).is_err());
        // 全配置错误 → 报错
        let all_bad = vec![CandidateResult {
            values: cand(&[("a", 1.0)], 0.0).values,
            status: CandidateStatus::ConfigError("越界".into()),
            metric_stats: Vec::new(),
            target_outcomes: Vec::new(),
        }];
        assert!(training_rows(&all_bad, MetricKey::WinRate).is_err());
    }

    #[test]
    fn 预测缺特征报错且模型可序列化回读() {
        let model = RandomForest::train(
            "win_rate",
            vec!["a".into(), "b".into()],
            synth_rows(),
            SurrogateSpec::new(5),
        )
        .unwrap();
        let mut params = BTreeMap::new();
        params.insert("a".to_string(), 50.0);
        assert!(model.predict(&params).is_err());
        params.insert("b".to_string(), 5.0);
        let v = model.predict(&params).unwrap();
        assert!((50.0..=250.0).contains(&v), "预测 {} 越谱", v);

        let json = serde_json::to_string(&model).unwrap();
        let back: RandomForest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.predict(&params).unwrap(), v);
    }

    #[test]
    fn 超参校验() {
        let mut spec = SurrogateSpec::new(1);
        spec.trees = 0;
        assert!(spec.validate().is_err());
        spec.trees = 1;
        spec.max_depth = 0;
        assert!(spec.validate().is_err());
        spec.max_depth = 1;
        spec.min_samples_leaf = 0;
        assert!(spec.validate().is_err());
        spec.min_samples_leaf = 1;
        assert!(spec.validate().is_ok());
    }
}
