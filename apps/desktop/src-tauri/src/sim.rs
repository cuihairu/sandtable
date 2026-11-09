//! 仿真命令域(桌面壳):长任务进度事件 / 取消令牌登记 / 扫描预算门 +
//! 逐 replicate 仿真命令(run_simulation / cancel_run)。进度粒度刻意落在
//! replicate 边界(内核无中途退出面,仿真语义零改动)。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::State;

use crate::model::load;

/// 长任务进度事件:`done` / `total` 为 replicate 计数(与 CLI `--replicates`
/// 同口径),前端据此画进度条。
#[derive(Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct ProgressEvent {
    pub(crate) done: u32,
    pub(crate) total: u32,
}

/// 桌面 replicates 上界(ST-AUD-11 / I-011):与 WASM `MAX_REPLICATES=64` 对齐。
/// 此前桌面无门,`invoke("run_simulation", {replicates: 4294967295})` 会
/// 立即申请数十 GB(Vec::with_capacity)分配失败即 abort(不可捕获)。
pub(crate) const MAX_REPLICATES: u32 = 64;

/// 桌面扫描 / 寻优的仿真预算(ST-AUD-17/19 / I-017/I-019,与 CLI 同一口径,
/// 文档 12 章):规模门由加载器统一把关;此处收紧单候选驻留内存
/// (R × days,每 replicate 持 days 个 DayStats)与总工作量
/// (候选 × R × players × days)。桌面 native 此前仅靠 core 候选 /
/// replicates 上限兜底,大 R × 大 days 仍会 OOM。
pub(crate) const MAX_DESKTOP_REPLICATE_DAYS: u64 = 2_000_000;
pub(crate) const MAX_DESKTOP_SIM_WORK: u64 = 1_000_000_000;

/// 扫描 / 寻优共用的预算门:驻留内存(R × days)+ 总工作量
/// ([`sandtable_core::sweep::sim_work`] 统一账),超限 Err(消息与 CLI 同文)。
pub(crate) fn check_sweep_budget(
    candidates: usize,
    replicates: u32,
    players: u32,
    days: u32,
) -> Result<(), String> {
    let rd = sandtable_core::sweep::sim_work(1, replicates, 1, days);
    if rd > MAX_DESKTOP_REPLICATE_DAYS {
        return Err(format!(
            "参数错误: replicates × days = {rd} 超出驻留内存预算 {MAX_DESKTOP_REPLICATE_DAYS}(调小 replicates 或 duration)"
        ));
    }
    let work = sandtable_core::sweep::sim_work(candidates, replicates, players, days);
    if work > MAX_DESKTOP_SIM_WORK {
        return Err(format!(
            "参数错误: 总仿真工作量 {work} 超出预算 {MAX_DESKTOP_SIM_WORK}(调小网格 / replicates / population / duration)"
        ));
    }
    Ok(())
}

/// 取消令牌:活动任务在 replicate 边界轮询。
pub(crate) type CancelFlag = Arc<AtomicBool>;

/// 活动长任务登记:桌面同一时刻只认一个活动令牌(`run_simulation`),
/// 取消无需任务 id,前端 `cancel_run` 即可命中。
#[derive(Default)]
pub(crate) struct TaskRegistry(Mutex<Option<CancelFlag>>);

impl TaskRegistry {
    /// 登记新令牌(顶替遗留令牌——上一任务若因 panic 未清理,不堵新任务)。
    pub(crate) fn register(&self) -> CancelFlag {
        let mut slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        let flag = Arc::new(AtomicBool::new(false));
        *slot = Some(flag.clone());
        flag
    }

    /// 结束清理;返回被清走的令牌(测试据此断言登记生命周期)。
    pub(crate) fn take(&self) -> Option<CancelFlag> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).take()
    }

    /// 置位活动令牌;无活动任务时为无操作。返回是否有任务被命中。
    pub(crate) fn cancel_active(&self) -> bool {
        let slot = self.0.lock().unwrap_or_else(|e| e.into_inner());
        match &*slot {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }
}

/// 逐 replicate 执行:每个 replicate 开跑前检查取消令牌,完成后上报一次进度。
/// 取消返回 Err 且不产出半截结果——少 replicate 的 results 过不了实验层
/// 汇总口径(CI₉₅ 按 replicate 数算),宁缺毋错。
pub(crate) fn run_replicates(
    cfg: &sandtable_core::config::SimConfig,
    replicates: u32,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(u32),
) -> Result<Vec<sandtable_core::metrics::RunMetrics>, String> {
    // ST-AUD-11:不再预分配 with_capacity(超大门直接 abort),改按需 push。
    let mut results = Vec::new();
    for r in 0..replicates {
        if cancel.load(Ordering::Relaxed) {
            return Err(format!("已取消: 完成 {r}/{replicates} replicate"));
        }
        results
            .try_reserve(1)
            .map_err(|e| format!("结果缓冲分配失败: {e}"))?;
        results.push(sandtable_core::sim::run(cfg, r));
        progress(r + 1);
    }
    Ok(results)
}

/// 运行仿真命令体:`{meta, config_hash, days_csv, results}`;与 wasm
/// run_simulation_native 逐字段同构,days_csv 与 CLI simulate --out 同字节。
pub(crate) fn run_simulation_impl(
    yaml: &str,
    replicates: u32,
    cancel: &CancelFlag,
    progress: &mut dyn FnMut(u32),
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_REPLICATES {
        return Err(format!(
            "参数错误: 桌面 replicates 上限 {MAX_REPLICATES}(更大实验走 CLI)"
        ));
    }
    let cfg = load(yaml)?;
    let results = run_replicates(&cfg, replicates, cancel, progress)?;
    Ok(serde_json::json!({
        "meta": {
            "schema_version": sandtable_core::SCHEMA_VERSION,
            "model_version": sandtable_core::MODEL_VERSION,
        },
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "days_csv": sandtable_core::export::day_csv(&results[0]),
        "results": results,
    }))
}

/// 运行仿真(异步长任务):CPU 重活在 spawn_blocking 线程跑,不占主线程/
/// 异步运行时;逐 replicate 进度经 `onProgress` Channel 推给前端,取消走
/// `cancel_run`(replicate 边界生效)。Channel 不能套 Option(非 Deserialize,
/// 只能作裸命令参数),故 onProgress 为必传——前端唯一调用方同步更新。
#[tauri::command]
pub(crate) async fn run_simulation(
    yaml: String,
    replicates: u32,
    on_progress: Channel<ProgressEvent>,
    state: State<'_, TaskRegistry>,
) -> Result<serde_json::Value, String> {
    let flag = state.register();
    let total = replicates;
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut emit = Box::new(move |done| {
            let _ = on_progress.send(ProgressEvent { done, total });
        });
        run_simulation_impl(&yaml, replicates, &flag, &mut emit)
    })
    .await
    .unwrap_or_else(|e| Err(format!("仿真任务被中断: {e}")));
    state.take();
    out
}

/// 取消活动长任务(`run_simulation`);replicate 边界生效,已结束/无任务时
/// 为无操作。返回是否命中活动任务(前端据此提示)。
#[tauri::command]
pub(crate) fn cancel_run(state: State<'_, TaskRegistry>) -> bool {
    state.cancel_active()
}
