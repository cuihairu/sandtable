// todo L381 批四 · 自定义 KPI:表达式在 UI 编辑,校验与求值都进内核
// (core::kpi_custom)——前端不复制白名单、不重算任何统计。
// - 校验先于求值(kpiValidate 只编译,不碰运行期数据),错误走内核原文
//   (配置错误 通道:未知变量点名、常量表达式拒绝);
// - 求值(kpiEval)回传 expression 原文 + vars 白名单 + used_vars(声明序去重)
//   + 定义版本与方法口径,构成可复现口径:同 expression + vars + 版本 ⇒ 同结果;
// - 逐 replicate 值里的 null 是「指标缺席或求值 NaN」,UI 记「不可用」不填 0;
//   stats 整键缺席 = 可用 replicate < 2,不给统计区间(与 daily_aggregate
//   同一条缺席 ≠ 0 红线),这里不画置信带。
import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import type { CustomKpiOutput, CustomKpiShape, RunMetrics } from '../../lib/types.ts'
import { kpiEval, kpiValidate } from '../../lib/wasm.ts'
import { classifyWasmError } from '../../lib/errors.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type CustomKpiSectionProps = {
  /** 已跑 run 的逐 replicate 结果(null = 还没有 run) */
  results: RunMetrics[] | null
  /** 结果归属 run,口径行记录用于复算对账 */
  runId: string
}

/** 表达式正文的显示精度:自定义表达式无量纲字典,固定上界不换算(不套百分数) */
const FRACTIONS = { maxFractionDigits: 6 }

/** 通道消息 → 展示正文(内核原文,不重写措辞) */
function textOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return classifyWasmError(message).message
}

export function CustomKpiSection({ results, runId }: CustomKpiSectionProps): JSX.Element {
  const locale = useLocale()
  const [expression, setExpression] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shape, setShape] = useState<CustomKpiShape | null>(null)
  const [output, setOutput] = useState<CustomKpiOutput | null>(null)
  const ready = results !== null && results.length > 0

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const checked = await kpiValidate(expression)
        setShape(checked)
        const evaluated = await kpiEval(expression, results ?? [])
        setOutput(evaluated)
      } catch (caught) {
        setShape(null)
        setOutput(null)
        setError(textOf(caught))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <section className="custom-kpi" style={{ marginTop: 12 }}>
      <h2>{t(locale, 'analysis.customKpiTitle')}</h2>
      <p className="note">{t(locale, 'analysis.customKpiNote')}</p>
      {!ready && <p role="status">{t(locale, 'analysis.customKpiNeedRun')}</p>}
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="text"
          value={expression}
          onChange={(event) => setExpression(event.currentTarget.value)}
          placeholder="clamp(win_rate, 0, 1) * 2"
          aria-label={t(locale, 'analysis.customKpiExprAria')}
          aria-invalid={error !== null}
          style={{ flex: 1, fontFamily: 'var(--wb-mono)' }}
        />
        <button className="btn" type="submit" disabled={!ready || busy}>
          {busy ? t(locale, 'analysis.customKpiRunning') : t(locale, 'analysis.customKpiRun')}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {shape && (
        <p className="note">
          {t(locale, 'analysis.customKpiUsedVars', { count: shape.used_vars.length })}{' '}
          <code>{shape.used_vars.join(', ')}</code>
        </p>
      )}
      {output && (
        <table className="candidate-table" aria-label={t(locale, 'analysis.customKpiPerReplicateAria')}>
          <thead>
            <tr>
              <th>{t(locale, 'analysis.customKpiReplicate')}</th>
              <th>{t(locale, 'analysis.customKpiValue')}</th>
            </tr>
          </thead>
          <tbody>
            {output.per_replicate.map((cell, index) => (
              <tr key={index}>
                <td className="numeric">{index + 1}</td>
                {/* data-value 只在内核返回了值时在场上:缺席(指标缺失/NaN)不造 0 */}
                <td className="numeric" data-value={cell === null ? undefined : String(cell)}>
                  {cell === null ? t(locale, 'analysis.unavailable') : fmtNumber(locale, cell, FRACTIONS)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {output && (output.stats ? (
        <p className="note">
          {t(locale, 'analysis.customKpiStats', {
            n: output.stats.n,
            mean: fmtNumber(locale, output.stats.mean, FRACTIONS),
            lo: fmtNumber(locale, output.stats.ci95_lo, FRACTIONS),
            hi: fmtNumber(locale, output.stats.ci95_hi, FRACTIONS),
            sd: fmtNumber(locale, output.stats.sd, FRACTIONS),
          })}
        </p>
      ) : (
        <p role="status">{t(locale, 'analysis.customKpiNoStats', { n: output.n_used })}</p>
      ))}
      {output && (
        <p className="note mono">
          {t(locale, 'analysis.customKpiCaliber', {
            run: runId,
            schema: output.schema_version,
            sd: output.sd_method,
            ci: output.ci_method,
            vars: output.vars.length,
          })}
        </p>
      )}
      {shape && (
        <p className="note">{t(locale, 'analysis.customKpiVarsHint')} <code>{shape.vars.join(', ')}</code></p>
      )}
    </section>
  )
}
