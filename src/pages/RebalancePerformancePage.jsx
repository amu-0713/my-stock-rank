// src/pages/RebalancePerformancePage.jsx
// 「換倉至今表現」— 整體持倉 + 個股換倉至今報酬視覺化（首頁 / 排名頁的第二入口）
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'

const STRATEGY_TITLES = {
  '1': '動態多因子策略',
  '2': '高息低波策略',
}

const DATA_URL = {
  '1': '/result.json',
  '2': '/result_2.json',
}

// 台股慣例：紅漲綠跌。絕對值 <= FLAT_EPS 視為持平（灰色）。
const UP_COLOR = '#dc2626'
const DOWN_COLOR = '#16a34a'
const FLAT_COLOR = '#a1a1aa'
const FLAT_EPS = 0.05

function toneOf(v) {
  if (v === null || v === undefined || Number.isNaN(v) || Math.abs(v) <= FLAT_EPS) return 'flat'
  return v > 0 ? 'up' : 'down'
}

function toneColor(v) {
  const t = toneOf(v)
  return t === 'up' ? UP_COLOR : t === 'down' ? DOWN_COLOR : FLAT_COLOR
}

function toneTextClass(v) {
  const t = toneOf(v)
  return t === 'up' ? 'text-red-600' : t === 'down' ? 'text-green-600' : 'text-zinc-500'
}

function fmtSignedPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function HoldingBarRow({ rank, row, maxAbs }) {
  const val = row.return_since_rebalance_pct
  const pct = maxAbs > 0 ? Math.min(100, (Math.abs(val) / maxAbs) * 100) : 0
  const color = toneColor(val)
  return (
    <div className="flex items-center gap-2.5 py-1.5 sm:gap-3">
      <div className="w-5 shrink-0 text-right text-xs font-medium text-zinc-400 tabular-nums">{rank}</div>
      <div
        className="w-[76px] shrink-0 truncate text-sm font-medium text-zinc-800 sm:w-[96px]"
        title={`${row.full_name || row.name}（${row.stock_id}）`}
      >
        {row.name}
        <span className="ml-1 text-[11px] font-normal text-zinc-400">{row.stock_id}</span>
      </div>
      <div className="relative h-5 flex-1 overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className={`w-[58px] shrink-0 text-right text-sm font-semibold tabular-nums sm:w-16 ${toneTextClass(val)}`}>
        {fmtSignedPct(val)}
      </div>
    </div>
  )
}

export default function RebalancePerformancePage() {
  const { id } = useParams()
  const dataUrl = DATA_URL[id] ?? DATA_URL['1']
  const title = STRATEGY_TITLES[id] ?? `策略${id}`

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(dataUrl, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`讀取資料失敗：HTTP ${res.status}`)
        return await res.json()
      })
      .then((json) => { if (!cancelled) setData(json) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '讀取資料失敗') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [dataUrl])

  const sinceRebalance = data?.overview?.since_rebalance

  const sortedHoldings = useMemo(() => {
    const holdings = data?.current_holdings_rank ?? []
    return holdings
      .filter((h) => h.return_since_rebalance_pct !== undefined && h.return_since_rebalance_pct !== null)
      .slice()
      .sort((a, b) => b.return_since_rebalance_pct - a.return_since_rebalance_pct)
  }, [data])

  const breadth = useMemo(() => {
    let up = 0, down = 0, flat = 0
    for (const h of sortedHoldings) {
      const t = toneOf(h.return_since_rebalance_pct)
      if (t === 'up') up++
      else if (t === 'down') down++
      else flat++
    }
    return { up, down, flat }
  }, [sortedHoldings])

  const pieData = useMemo(() => (
    [
      { key: 'up', label: '上漲', value: breadth.up, color: UP_COLOR },
      { key: 'down', label: '下跌', value: breadth.down, color: DOWN_COLOR },
      { key: 'flat', label: '持平', value: breadth.flat, color: FLAT_COLOR },
    ].filter((d) => d.value > 0)
  ), [breadth])

  const maxAbs = useMemo(() => (
    sortedHoldings.reduce((max, h) => Math.max(max, Math.abs(h.return_since_rebalance_pct ?? 0)), 0)
  ), [sortedHoldings])

  return (
    <AppSidebarLayout contentClassName="max-w-[720px] mx-auto">
      <div className="pb-10">
        <Link to={`/strategy/${id}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800">
          <ChevronLeft size={16} /> 返回排名
        </Link>
        <h1 className="mt-2 text-lg font-semibold sm:text-xl">{title}・換倉至今表現</h1>
        {sinceRebalance?.date && (
          <p className="mt-1 text-sm text-zinc-500">
            自最近換倉日 {sinceRebalance.date} 至 {data?.latest_date ?? '—'}
            {data?.regime_at_rebalance && (
              <>
                ・換倉當時系統判斷
                <span className={`font-semibold ${data.regime_at_rebalance === 'bear' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {data.regime_at_rebalance === 'bear' ? '熊市' : '牛市'}
                </span>
                ，選出 {sortedHoldings.length} 檔
              </>
            )}
          </p>
        )}

        {loading ? (
          <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
            資料載入中...
          </div>
        ) : error ? (
          <div className="mt-6 rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
            {error}
          </div>
        ) : (
          <>
            {/* 整體摘要：大數字 + 上漲/下跌/持平圓餅圖 */}
            <div className="mt-6 flex flex-col items-center gap-6 rounded-2xl border border-zinc-200 bg-white p-6 sm:flex-row sm:justify-between">
              <div className="text-center sm:text-left">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">整體持倉換倉至今報酬</div>
                <div className={`mt-1 text-4xl font-bold ${toneTextClass(sinceRebalance?.return_pct)}`}>
                  {fmtSignedPct(sinceRebalance?.return_pct)}
                </div>
                <div className="mt-2 text-sm text-zinc-500">
                  {breadth.up} 檔上漲・{breadth.down} 檔下跌
                  {breadth.flat ? `・${breadth.flat} 檔持平` : ''}
                  （共 {sortedHoldings.length} 檔，等權重平均）
                </div>
              </div>

              {pieData.length > 0 && (
                <div className="h-[140px] w-[140px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        dataKey="value"
                        nameKey="label"
                        innerRadius={38}
                        outerRadius={60}
                        paddingAngle={pieData.length > 1 ? 3 : 0}
                        strokeWidth={0}
                      >
                        {pieData.map((d) => <Cell key={d.key} fill={d.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, name) => [`${value} 檔`, name]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* 個股換倉至今報酬（由高到低） */}
            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5">
              <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                個股換倉至今報酬（由高到低）
              </div>
              {sortedHoldings.length > 0 ? (
                <div className="divide-y divide-zinc-100">
                  {sortedHoldings.map((row, index) => (
                    <HoldingBarRow key={row.stock_id} rank={index + 1} row={row} maxAbs={maxAbs} />
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-zinc-500">目前沒有資料</div>
              )}
            </div>

            <p className="mt-4 text-center text-[11px] text-zinc-400">
              報酬已含股息，數字來自 FinLab 回測引擎的實際成交紀錄。僅供研究參考，不構成投資建議。
            </p>
          </>
        )}
      </div>
    </AppSidebarLayout>
  )
}
