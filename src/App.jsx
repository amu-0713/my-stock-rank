import { Navigate, Route, Routes } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
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
        <Route path="/" element={<HomePage />} />
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
