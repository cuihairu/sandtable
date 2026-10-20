import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { entryRoute } from './entryRoute.ts'
// V2 工作台(WB-02)是默认入口,无 hash 与任意非 legacy hash 都进入;
// #/workbench/analysis 等深链直达工作台,#/legacy 保留现役 Phase 6 单页。
// 两套界面共存,V2 迁移完成前不互删。
import WorkbenchApp from './workbench/WorkbenchApp.tsx'

const route = entryRoute(window.location.hash)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {route === 'workbench' ? <WorkbenchApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
