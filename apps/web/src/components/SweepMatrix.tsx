// 双轴联合可行域矩阵(docs 22 后续项:多参数轴联合可行域):
// 行 = 轴 1 取值,列 = 轴 2 取值,格 = 该目标下的判定三色(复用候选表 chip)。
// 网格模式全格有值;Random 采样天然稀疏,未覆盖的格如实留空(·)。
// 单轴推荐带(文档 15 章)仍只适用单轴,矩阵不替代推荐。
import type { CandidateResult, ConstraintVerdict } from '../lib/types'

const VERDICT_LABEL: Record<ConstraintVerdict, string> = {
  pass: 'PASS',
  borderline: 'BORDER',
  fail: 'FAIL',
}

function fmtVal(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

interface Props {
  yPath: string // 行轴
  xPath: string // 列轴
  metric: string
  results: CandidateResult[]
}

export default function SweepMatrix({ yPath, xPath, metric, results }: Props) {
  const ok = results.filter((r) => r.status === 'ok')
  // 两轴取值去重升序:网格 = 格点数;Random 采样值各不相同 →
  // 行列数随样本数膨胀,调用方(面板)按规模上限决定是否出矩阵
  const ys = [...new Set(ok.map((r) => r.values[yPath]))].sort((a, b) => a - b)
  const xs = [...new Set(ok.map((r) => r.values[xPath]))].sort((a, b) => a - b)
  // 格查找:同一次运行内候选取值彼此全等,键直接用原始浮点串接
  const cells = new Map<
    string,
    { verdict: ConstraintVerdict } | { error: string }
  >()
  for (const r of results) {
    const key = `${r.values[yPath]}|${r.values[xPath]}`
    if (r.status !== 'ok') {
      cells.set(key, { error: r.status.config_error })
    } else {
      const o = r.target_outcomes.find((t) => t.metric === metric)
      if (o) cells.set(key, { verdict: o.verdict })
    }
  }

  // 规模上限:单轴取值过多(如 Random 24 样本各不相同)矩阵会膨胀成
  // 数百格的稀疏大表,如实降级为提示,不硬渲染
  if (ys.length > 12 || xs.length > 12) {
    return (
      <p className="note">
        {metric}:单轴取值过多(行 {ys.length} × 列 {xs.length}),矩阵略,详见候选表。
      </p>
    )
  }

  return (
    <figure className="chart">
      <figcaption className="hash">
        {metric}(行 = {yPath},列 = {xPath})
      </figcaption>
      <table>
        <thead>
          <tr>
            <th>
              {yPath.split('.').pop()} \ {xPath.split('.').pop()}
            </th>
            {xs.map((x) => (
              <th key={x}>{fmtVal(x)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ys.map((y) => (
            <tr key={y}>
              <th>{fmtVal(y)}</th>
              {xs.map((x) => {
                const c = cells.get(`${y}|${x}`)
                return (
                  <td key={x} className="sweep-matrix-cell">
                    {c ? (
                      'error' in c ? (
                        <span className="error" title={c.error}>
                          E
                        </span>
                      ) : (
                        <span className={`chip chip-${c.verdict}`}>
                          {VERDICT_LABEL[c.verdict]}
                        </span>
                      )
                    ) : (
                      <span className="note">·</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
