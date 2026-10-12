// 渲染期异常兜底:React 18 渲染 throw 会卸载整树 = 全页白屏(2026-10-13
// 无头走查:会话内查询面板点「查询」后整页白屏,进程存活、resize 不恢复,
// exec 的 try/catch 管不到渲染期),边界把白屏换成错误文案 + 重载按钮,
// 让异常可报告。事件回调与 Promise 内的异常不走这里(各面板已自行接住)。
import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // 留一条控制台痕迹(打包后用户环境也可见于 devtools)
    console.error('UI 渲染异常:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="panel">
        <h2>界面渲染出错</h2>
        <p className="error">{String(error?.message ?? error)}</p>
        <p className="note">
          已显示的仿真 / 扫描结果在内存里,重载页面会清空;可先把产物下载再重载。
        </p>
        <button className="primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    )
  }
}
