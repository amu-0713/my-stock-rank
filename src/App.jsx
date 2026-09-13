import { Navigate, Route, Routes } from 'react-router-dom'
import Home from './pages/HomePage.jsx' // 手機跑版，暫時改回舊版首頁；訊號 Signal 新版留在 Home.jsx 未刪，修好再換回來
import StrategySelectPage from './pages/StrategySelectPage.jsx'
import StrategyPage from './pages/StrategyPage.jsx'
import StrategyInfoPage from './pages/StrategyInfoPage.jsx'
import RebalancePerformancePage from './pages/RebalancePerformancePage.jsx'
import AuthMenu from './components/AuthMenu.jsx'

function App() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      {/* Optional auth: fixed top-right on all pages; does not gate routes */}
      <AuthMenu />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/strategies" element={<StrategySelectPage />} />
        <Route path="/strategy/:id" element={<StrategyPage />} />
        <Route path="/strategy/:id/info" element={<StrategyInfoPage />} />
        <Route path="/strategy/:id/rebalance" element={<RebalancePerformancePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export default App
