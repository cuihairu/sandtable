import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
// V2 工作台(WB-02):以 hash 深链进入,如 #/workbench/analysis。
// 默认仍是现役 Phase 6 单页应用——两套界面共存,V2 迁移完成前不互删。
import WorkbenchApp from './workbench/WorkbenchApp.tsx'

const useWorkbench = window.location.hash.startsWith('#/workbench/')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {useWorkbench ? <WorkbenchApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
