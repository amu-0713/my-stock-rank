import { useState, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronDown, HelpCircle } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

const BACKTEST_DATA_URL = {
  '1': '/result.json',
  '2': '/result_2.json',
}

const VALIDATION_DATA_URL = {
  '1': '/validation.json',
  '2': '/validation_2.json',
}

function fmtPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

// 無方向性的量值（波動率等）：不加正負號，避免看起來像「上漲」
function fmtMagnitudePct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${v.toFixed(digits)}%`
}

function fmtRatio(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

// 從 top_drawdowns（前5大回撤週期）算平均修復天數，只計入「已回補」的幾筆
function avgRecoveryDays(drawdowns) {
  if (!drawdowns?.length) return null
  const recovered = drawdowns.filter((d) => d.recovered && d.recovery_days !== null && d.recovery_days !== undefined)
  if (recovered.length === 0) return null
  const sum = recovered.reduce((acc, d) => acc + d.recovery_days, 0)
  return { avg: sum / recovered.length, count: recovered.length, total: drawdowns.length }
}

function fmtDays(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return `${Math.round(v)} 天`
}

function toneClass(v) {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return 'text-zinc-900'
  return v > 0 ? 'text-emerald-600' : 'text-red-600'
}

// 專有名詞 hover 提示：滑鼠移到問號圖示上顯示白話解釋，避免術語看不懂又不想開新視窗
function TermHint({ text }) {
  return (
    <span className="group/hint relative ml-1 inline-flex align-middle">
      <HelpCircle size={13} className="cursor-help text-zinc-400" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-zinc-800 px-2.5 py-1.5 text-left text-[11px] font-normal leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/hint:opacity-100">
        {text}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
      </span>
    </span>
  )
}

// 帶提示的標籤：{文字}{問號}
function TermLabel({ children, hint }) {
  return (
    <span className="inline-flex items-center">
      {children}
      <TermHint text={hint} />
    </span>
  )
}

const TERM_HINTS = {
  volatility: '報酬起伏的劇烈程度，數字越高代表淨值上下震盪越明顯，不一定代表虧錢，但持有過程會比較有感。',
  sharpe: '報酬相對於總波動風險的比率，數字越高代表承擔同樣的風險、換到的報酬越多。',
  sortino: '跟夏普比率類似，但只計算「下跌」的波動，不把上漲的波動也算進風險，更貼近投資人真正在意的下跌風險。',
  calmar: '年化報酬除以最大回撤，數字越高代表賺到的報酬，相對於曾經最慘跌過的幅度越划算。',
  var5: '模擬情境中，表現最差的5%所對應的年化報酬——白話說就是「運氣不好時，大概會慘到什麼程度」的估計，數字是這5%最差情境的下限。',
  efficiency: '把該分數區間的平均報酬，除以報酬的離散程度算出來的比率，避免只看平均報酬被少數極端值誤導。',
}

function StatTile({ label, value, tone = 'text-zinc-900', sub }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div> : null}
    </div>
  )
}

function YearlyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const strategy = payload.find((p) => p.dataKey === 'strategy')
  const benchmark = payload.find((p) => p.dataKey === 'benchmark')
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[140px]">
      <p className="text-[11px] text-zinc-500 mb-2 border-b pb-1">{label} 年</p>
      <div className="space-y-1.5">
        <div className="flex justify-between items-center gap-4">
          <span className="text-xs text-emerald-600 font-medium">策略</span>
          <span className="text-sm font-bold text-emerald-600">{fmtPct(strategy?.value)}</span>
        </div>
        <div className="flex justify-between items-center gap-4">
          <span className="text-xs text-zinc-400 font-medium">大盤</span>
          <span className="text-sm font-bold text-zinc-500">{fmtPct(benchmark?.value)}</span>
        </div>
      </div>
    </div>
  )
}

// 逐月報酬熱力圖顏色：正報酬用綠、負報酬用紅，深淺代表幅度，±15% 封頂避免極端值洗掉其他格子
function heatCellStyle(value) {
  if (value === null || value === undefined) {
    return { background: '#f4f4f5', color: '#a1a1aa' }
  }
  const capped = Math.max(-15, Math.min(15, value))
  const t = Math.abs(capped) / 15
  const lightness = 94 - t * 44
  const hue = value >= 0 ? 152 : 0
  const color = t > 0.55 ? '#ffffff' : '#27272a'
  return { background: `hsl(${hue}, 55%, ${lightness}%)`, color }
}

function YearlyMddTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const strategy = payload.find((p) => p.dataKey === 'strategy')
  const benchmark = payload.find((p) => p.dataKey === 'benchmark')
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[150px]">
      <p className="mb-2 border-b pb-1 text-[11px] text-zinc-500">{payload[0]?.payload?.year} 年，各自年內最深回撤</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-emerald-600">策略</span>
          <span className="text-sm font-bold text-red-600">{fmtPct(strategy?.value)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-zinc-400">大盤</span>
          <span className="text-sm font-bold text-red-600">{fmtPct(benchmark?.value)}</span>
        </div>
      </div>
    </div>
  )
}

// Top 5 最慘年度：以「策略」或「大盤」其中一方自己歷年最深回撤挑出最慘的 5 個年度，
// 兩邊都用「該年度自己的最深回撤」比較（各自的時間軸，不是精確同期窗口）
function TopDrawdownYearsSection({ yearlyMaxDrawdown }) {
  const [view, setView] = useState('strategy')

  if (!yearlyMaxDrawdown?.length) return null

  const refLabel = view === 'benchmark' ? '大盤' : '策略'

  const chartData = yearlyMaxDrawdown
    .filter((r) => r[view] !== null && r[view] !== undefined)
    .slice()
    .sort((a, b) => a[view] - b[view])
    .slice(0, 5)
    .sort((a, b) => a.year - b.year)
    .map((r) => ({ year: String(r.year), strategy: r.strategy, benchmark: r.benchmark }))

  const pill = (active) =>
    `px-3 py-1 text-xs font-medium rounded-lg transition ${
      active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
    }`

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Top 5 最慘年度（{refLabel}最深回撤最大的 5 年）
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setView('strategy')} className={pill(view === 'strategy')}>
            策略基準
          </button>
          <button type="button" onClick={() => setView('benchmark')} className={pill(view === 'benchmark')}>
            大盤基準
          </button>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-3">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={3}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
            <XAxis dataKey="year" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}%`} />
            <Tooltip content={<YearlyMddTooltip />} cursor={{ fill: '#f4f4f5' }} />
            <Legend
              verticalAlign="top"
              align="right"
              height={28}
              iconType="circle"
              formatter={(value) => <span className="text-xs text-zinc-600">{value}</span>}
            />
            <Bar dataKey="strategy" name="策略" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={26} />
            <Bar dataKey="benchmark" name="大盤" fill="#a1a1aa" radius={[3, 3, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
        <p className="mt-2 text-[11px] text-zinc-400">
          依{refLabel}歷年最深回撤挑出最慘的 5 個年度；長條為策略／大盤各自在該年度「自己」的最深回撤（各自時間軸，不是同一段精確日期）。
        </p>
      </div>
    </div>
  )
}

function BacktestOverviewSection({ strategyId }) {
  const dataUrl = BACKTEST_DATA_URL[strategyId] ?? BACKTEST_DATA_URL['1']
  const [overview, setOverview] = useState(null)
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
      .then((json) => {
        if (cancelled) return
        setOverview(json?.overview ?? null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '讀取資料失敗')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [dataUrl])

  const yearlyData = useMemo(() => {
    if (!overview?.yearly_returns) return []
    return overview.yearly_returns.map((r) => ({
      year: String(r.year),
      strategy: r.strategy,
      benchmark: r.benchmark,
    }))
  }, [overview])

  const monthlyByYear = useMemo(() => {
    if (!overview?.monthly_returns) return []
    const map = new Map()
    overview.monthly_returns.forEach((r) => {
      if (!map.has(r.year)) map.set(r.year, {})
      map.get(r.year)[r.month] = r.return
    })
    const yearlyMap = new Map((overview.yearly_returns ?? []).map((r) => [r.year, r.strategy]))
    return Array.from(map.keys())
      .sort((a, b) => b - a)
      .map((year) => ({ year, months: map.get(year), total: yearlyMap.get(year) }))
  }, [overview])

  // 月勝率：正報酬月份占全部有資料月份的比例
  const monthlyWinRate = useMemo(() => {
    const returns = overview?.monthly_returns
    if (!returns?.length) return null
    const wins = returns.filter((r) => r.return > 0).length
    return { wins, total: returns.length, rate: (wins / returns.length) * 100 }
  }, [overview])

  // 逐年贏過大盤的次數
  const yearsBeatBenchmark = useMemo(() => {
    const rows = (overview?.yearly_returns ?? []).filter(
      (r) => r.strategy !== null && r.strategy !== undefined && r.benchmark !== null && r.benchmark !== undefined,
    )
    if (!rows.length) return null
    const wins = rows.filter((r) => r.strategy > r.benchmark).length
    return { wins, total: rows.length }
  }, [overview])

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        資料載入中...
      </div>
    )
  }

  if (error || !overview) {
    return (
      <div className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
        {error ?? '尚無回測資料'}
      </div>
    )
  }

  const bench = overview.benchmark
  const hasRiskDetail = overview.volatility_all !== undefined
  const strategyRecovery = avgRecoveryDays(overview.top_drawdowns)
  const benchmarkRecovery = avgRecoveryDays(bench?.top_drawdowns)

  return (
    <div className="space-y-6">
      {/* 核心績效 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          核心績效（回測起始：{overview.start_date ?? '—'}）
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatTile label="總報酬" value={fmtPct(overview.total_return_all, 0)} tone={toneClass(overview.total_return_all)} />
          <StatTile label="年化報酬" value={fmtPct(overview.annual_return_all)} tone={toneClass(overview.annual_return_all)} />
          <StatTile label="今年報酬" value={fmtPct(overview.total_return_ytd)} tone={toneClass(overview.total_return_ytd)} />
          <StatTile label="近1年" value={fmtPct(overview.total_return_1y)} tone={toneClass(overview.total_return_1y)} />
          <StatTile label="近3年" value={fmtPct(overview.total_return_3y)} tone={toneClass(overview.total_return_3y)} />
          <StatTile label="近5年" value={fmtPct(overview.total_return_5y)} tone={toneClass(overview.total_return_5y)} />
        </div>
      </div>

      {/* 風險指標：策略 vs 大盤 */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          風險指標（策略 vs 大盤同期）
        </div>
        <div className="overflow-x-auto rounded-xl border border-zinc-200">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">指標</th>
                <th className="px-4 py-2.5 font-medium">策略</th>
                <th className="px-4 py-2.5 font-medium">大盤</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              <tr>
                <td className="px-4 py-2.5 text-zinc-600">年化報酬</td>
                <td className={`px-4 py-2.5 font-semibold ${toneClass(overview.annual_return_all)}`}>{fmtPct(overview.annual_return_all)}</td>
                <td className={`px-4 py-2.5 font-semibold ${toneClass(bench?.annual_return_all)}`}>{fmtPct(bench?.annual_return_all)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600">最大回撤</td>
                <td className="px-4 py-2.5 font-semibold text-red-600">{fmtPct(overview.max_drawdown)}</td>
                <td className="px-4 py-2.5 font-semibold text-red-600">{fmtPct(bench?.max_drawdown)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.volatility}>年化波動率</TermLabel></td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtMagnitudePct(overview.volatility_all)}</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtMagnitudePct(bench?.volatility_all)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.sharpe}>夏普比率</TermLabel></td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(overview.sharpe_ratio)}</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(bench?.sharpe_ratio)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.sortino}>Sortino 比率</TermLabel></td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(overview.sortino_ratio)}</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(bench?.sortino_ratio)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.calmar}>Calmar 比率</TermLabel></td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(overview.calmar_ratio)}</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(bench?.calmar_ratio)}</td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-zinc-600">平均修復天數</td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">
                  {fmtDays(strategyRecovery?.avg)}
                  {strategyRecovery && strategyRecovery.count < strategyRecovery.total ? (
                    <span className="ml-1 text-xs font-normal text-zinc-400">（{strategyRecovery.count}/{strategyRecovery.total} 已回補）</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 font-semibold text-zinc-900">
                  {fmtDays(benchmarkRecovery?.avg)}
                  {benchmarkRecovery && benchmarkRecovery.count < benchmarkRecovery.total ? (
                    <span className="ml-1 text-xs font-normal text-zinc-400">（{benchmarkRecovery.count}/{benchmarkRecovery.total} 已回補）</span>
                  ) : null}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          平均修復天數取自歷史前 5 大回撤週期的平均值{!hasRiskDetail ? '；此策略的波動率／Sortino／Calmar 尚未提供，僅顯示既有指標' : ''}。
        </p>
      </div>

      {/* Top 5 最慘年度 */}
      <TopDrawdownYearsSection yearlyMaxDrawdown={overview.yearly_max_drawdown} />

      {/* 逐年報酬 */}
      {yearlyData.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              逐年報酬（策略 vs 大盤）
            </div>
            {yearsBeatBenchmark ? (
              <div className="text-xs font-medium text-zinc-500">
                贏過大盤 <span className="text-emerald-600">{yearsBeatBenchmark.wins}/{yearsBeatBenchmark.total}</span> 年
              </div>
            ) : null}
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={yearlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={3}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="year" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<YearlyTooltip />} cursor={{ fill: '#f4f4f5' }} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={28}
                  iconType="circle"
                  formatter={(value) => <span className="text-xs text-zinc-600">{value}</span>}
                />
                <Bar dataKey="strategy" name="策略" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="benchmark" name="大盤" fill="#a1a1aa" radius={[3, 3, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      {/* 逐月報酬熱力圖 */}
      {monthlyByYear.length > 0 ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              逐月報酬（策略）
            </div>
            {monthlyWinRate ? (
              <div className="text-xs font-medium text-zinc-500">
                月勝率 <span className="text-emerald-600">{monthlyWinRate.rate.toFixed(1)}%</span>
                <span className="ml-1 text-zinc-400">（{monthlyWinRate.wins}/{monthlyWinRate.total}）</span>
              </div>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white p-3">
            <table className="w-full min-w-[640px] border-separate text-center text-xs" style={{ borderSpacing: '3px' }}>
              <thead>
                <tr className="text-zinc-500">
                  <th className="px-1.5 py-1 text-left font-medium">年度</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} className="px-1 py-1 font-medium">{i + 1}月</th>
                  ))}
                  <th className="px-1.5 py-1 font-medium">全年</th>
                </tr>
              </thead>
              <tbody>
                {monthlyByYear.map(({ year, months, total }) => (
                  <tr key={year}>
                    <td className="px-1.5 py-1 text-left font-medium text-zinc-700">{year}</td>
                    {Array.from({ length: 12 }, (_, i) => {
                      const m = i + 1
                      const v = months[m]
                      return (
                        <td key={m} className="rounded-md px-1 py-1.5 font-medium" style={heatCellStyle(v)} title={v !== undefined ? `${year}/${m}：${fmtPct(v)}` : '無資料'}>
                          {v !== undefined ? v.toFixed(1) : ''}
                        </td>
                      )
                    })}
                    <td className="rounded-md px-1 py-1.5 font-semibold" style={heatCellStyle(total)}>
                      {total !== undefined ? fmtPct(total, 1) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-zinc-400">顏色深淺代表報酬幅度（±15% 以上視為滿格），綠色為獲利、紅色為虧損，數字已標示於每一格內。</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function MonteCarloStatRow({ label, strategy, benchmark, tone }) {
  return (
    <tr>
      <td className="px-4 py-2.5 text-zinc-600">{label}</td>
      <td className={`px-4 py-2.5 font-semibold ${tone ? toneClass(strategy) : 'text-zinc-900'}`}>{fmtPct(strategy)}</td>
      <td className={`px-4 py-2.5 font-semibold ${tone ? toneClass(benchmark) : 'text-zinc-900'}`}>{fmtPct(benchmark)}</td>
    </tr>
  )
}

function MonteCarloSection({ strategyId }) {
  const url = VALIDATION_DATA_URL[strategyId] ?? VALIDATION_DATA_URL['1']
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`讀取資料失敗：HTTP ${res.status}`)
        return await res.json()
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '讀取資料失敗')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [url])

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        資料載入中...
      </div>
    )
  }

  if (error || !data?.monte_carlo_15yr) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-400">
        此策略尚未提供驗證資料
      </div>
    )
  }

  const mc = data.monte_carlo_15yr

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-5 text-center">
        <div className="text-xs font-medium text-emerald-700">15 年後，策略贏過大盤的機率</div>
        <div className="mt-1 text-4xl font-bold text-emerald-600">{mc.win_rate.toFixed(0)}%</div>
        <div className="mt-1.5 text-[11px] text-zinc-500">{mc.n_simulations.toLocaleString()} 次季度隨機重組模擬</div>
        <div className="mt-1 text-[11px] text-zinc-400">（歷史回測的統計驗證，不代表、也不保證未來實際表現）</div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-2.5 font-medium">15年後年化報酬（模擬分布）</th>
              <th className="px-4 py-2.5 font-medium">策略</th>
              <th className="px-4 py-2.5 font-medium">大盤</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <MonteCarloStatRow label="最好情況" strategy={mc.strategy.best} benchmark={mc.benchmark.best} tone />
            <MonteCarloStatRow label="平均" strategy={mc.strategy.mean} benchmark={mc.benchmark.mean} tone />
            <MonteCarloStatRow label="中位數" strategy={mc.strategy.median} benchmark={mc.benchmark.median} tone />
            <MonteCarloStatRow label="最慘情況" strategy={mc.strategy.worst} benchmark={mc.benchmark.worst} tone />
            <MonteCarloStatRow label={<TermLabel hint={TERM_HINTS.var5}>風險地板（VaR 5%）</TermLabel>} strategy={mc.strategy.var5} benchmark={mc.benchmark.var5} tone />
          </tbody>
        </table>
      </div>

      {data.method_note ? <p className="text-xs leading-relaxed text-zinc-400">{data.method_note}</p> : null}
      {data.generated_at ? <p className="text-xs text-zinc-400">驗證時間：{data.generated_at}（非每日更新，方法不變時不會頻繁重跑）</p> : null}
    </div>
  )
}

function ScoreReturnTooltip({ active, payload, metric }) {
  if (!active || !payload || !payload.length) return null
  const d = payload[0].payload
  const isEfficiency = metric === 'efficiency'
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[160px] text-xs">
      <p className="mb-2 border-b pb-1 text-[11px] text-zinc-500">分數區間 {d.bin}</p>
      <div className="space-y-1.5">
        {isEfficiency ? (
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-zinc-500">風險調整效率</span>
            <span className={`text-sm font-bold ${toneClass(d.efficiency)}`}>{fmtRatio(d.efficiency, 3)}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium text-zinc-500">平均遠期報酬</span>
            <span className={`text-sm font-bold ${toneClass(d.avg_return)}`}>{fmtPct(d.avg_return)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="font-medium text-zinc-500">勝率</span>
          <span className="text-sm font-bold text-zinc-900">{d.win_rate}%</span>
        </div>
      </div>
      <div className="mt-2 border-t pt-1.5 text-zinc-400">樣本數 n = {d.n.toLocaleString()}</div>
    </div>
  )
}

function RollingReturnTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  const strategy = payload.find((p) => p.dataKey === 'strategy')
  const benchmark = payload.find((p) => p.dataKey === 'benchmark')
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[150px]">
      <p className="mb-2 border-b pb-1 text-[11px] text-zinc-500">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-emerald-600">策略</span>
          <span className="text-sm font-bold text-emerald-600">{fmtPct(strategy?.value)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-zinc-400">大盤</span>
          <span className="text-sm font-bold text-zinc-500">{fmtPct(benchmark?.value)}</span>
        </div>
      </div>
    </div>
  )
}

// 策略驗證：蒙地卡羅（獨立於每日資料，來自 validation.json）＋ 分數與遠期報酬驗證 ＋ 滾動1年報酬（兩者來自每日的 result.json）
function StrategyValidationSection({ strategyId }) {
  const dataUrl = BACKTEST_DATA_URL[strategyId] ?? BACKTEST_DATA_URL['1']
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(dataUrl, { cache: 'no-store' })
      .then(async (res) => (res.ok ? await res.json() : null))
      .then((json) => {
        if (cancelled) return
        setOverview(json?.overview ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [dataUrl])

  const scoreValidation = overview?.score_return_validation?.bins
  const scoreMetric = overview?.score_return_validation?.metric === 'efficiency' ? 'efficiency' : 'avg_return'
  const scoreForwardDays = overview?.score_return_validation?.forward_days
  const rollingReturn = useMemo(() => {
    if (!overview?.rolling_1y_return) return []
    return overview.rolling_1y_return.map((r) => ({ date: r.date, strategy: r.strategy, benchmark: r.benchmark }))
  }, [overview])

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          15 年長線蒙地卡羅測試
        </div>
        <MonteCarloSection strategyId={strategyId} />
      </div>

      {scoreValidation?.length ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
            評分是否真的有效：分數 vs {scoreMetric === 'efficiency' ? '風險調整效率' : '遠期報酬率'}
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={scoreValidation} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis dataKey="bin" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fill: '#71717a', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickFormatter={(v) => (scoreMetric === 'efficiency' ? v : `${v}%`)}
                />
                <Tooltip content={<ScoreReturnTooltip metric={scoreMetric} />} cursor={{ fill: '#f4f4f5' }} />
                <Bar
                  dataKey={scoreMetric}
                  name={scoreMetric === 'efficiency' ? '風險調整效率' : '平均遠期報酬'}
                  fill="#10b981"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>

            <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-zinc-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">分數區間</th>
                    <th className="px-3 py-2 font-medium">
                      {scoreMetric === 'efficiency' ? <TermLabel hint={TERM_HINTS.efficiency}>風險調整效率</TermLabel> : '平均報酬'}
                    </th>
                    <th className="px-3 py-2 font-medium">勝率</th>
                    <th className="px-3 py-2 font-medium">樣本數</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {scoreValidation.map((b) => (
                    <tr key={b.bin}>
                      <td className="px-3 py-2 font-medium text-zinc-700">{b.bin}</td>
                      {scoreMetric === 'efficiency' ? (
                        <td className={`px-3 py-2 font-semibold ${toneClass(b.efficiency)}`}>{fmtRatio(b.efficiency, 3)}</td>
                      ) : (
                        <td className={`px-3 py-2 font-semibold ${toneClass(b.avg_return)}`}>{fmtPct(b.avg_return)}</td>
                      )}
                      <td className="px-3 py-2 font-semibold text-zinc-900">{b.win_rate}%</td>
                      <td className="px-3 py-2 text-zinc-500">{b.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-2 text-[11px] text-zinc-400">
              取全期間每個交易日<strong className="font-semibold text-zinc-500">通過基本濾網</strong>的個股分數（不含營收為負、流動性不足等根本不會被選進來的股票），對照未來約{scoreForwardDays ?? 60}個交易日後的報酬率，依分數區間{scoreMetric === 'efficiency' ? '計算「風險調整效率」（平均報酬 ÷ 該區間報酬的離散度，避免少數極端值拉高平均報酬造成誤判）' : '取平均報酬'}。分數越高，{scoreMetric === 'efficiency' ? '效率與勝率' : '平均報酬與勝率'}應該要越高，才代表評分邏輯真的有效，不是隨便給分。
            </p>
          </div>
        </div>
      ) : null}

      {rollingReturn.length > 0 ? (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
            滾動 1 年報酬（策略 vs 大盤）
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={rollingReturn} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: '#71717a', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(d) => d.slice(0, 4)}
                  interval="preserveStartEnd"
                  minTickGap={40}
                />
                <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                <Tooltip content={<RollingReturnTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  height={28}
                  iconType="plainline"
                  formatter={(value) => <span className="text-xs text-zinc-600">{value}</span>}
                />
                <Line type="monotone" dataKey="strategy" name="策略" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="benchmark" name="大盤" stroke="#a1a1aa" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-2 text-[11px] text-zinc-400">每個時間點代表「過去1年」的報酬率，用來檢視績效是不是持續穩定，而不是靠少數幾段時間撐起來的。</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const COMBO_RATIOS = [
  { key: '30_70', label: '30 / 70' },
  { key: '50_50', label: '50 / 50' },
  { key: '70_30', label: '70 / 30' },
]

function ComboYearlyTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[120px]">
      <p className="text-[11px] text-zinc-500 mb-1.5 border-b pb-1">{label} 年</p>
      <span className="text-sm font-bold text-violet-600">{fmtPct(payload[0]?.value)}</span>
    </div>
  )
}

// 合併持有：跳轉到另一策略 + 動態/高息/合併三者比較（比例可切換）
function ComboSection({ strategyId }) {
  const [dynamicOverview, setDynamicOverview] = useState(null)
  const [highDivOverview, setHighDivOverview] = useState(null)
  const [combo, setCombo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [ratio, setRatio] = useState('50_50')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch('/result.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/result_2.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/combo.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([dyn, hd, cb]) => {
      if (cancelled) return
      setDynamicOverview(dyn?.overview ?? null)
      setHighDivOverview(hd?.overview ?? null)
      setCombo(cb)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const isStrategy2 = strategyId === '2'
  const otherTo = isStrategy2 ? '/strategy/1/info' : '/strategy/2/info'
  const otherName = isStrategy2 ? '動態多因子' : '高息低波'

  const blend = combo?.blends?.[ratio]
  const yearlyChartData = useMemo(() => {
    if (!blend?.yearly_returns) return []
    return blend.yearly_returns.map((r) => ({ year: String(r.year), value: r.return }))
  }, [blend])

  const pill = (active) =>
    `px-3 py-1 text-xs font-medium rounded-lg transition ${
      active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
    }`

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
        資料載入中...
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 用一般 <a> 而非 <Link>，強制整頁刷新——避免 SPA 導航後「搭配」區塊的比例狀態原封不動保留下來，讓人搞不清楚有沒有點到 */}
      <a
        href={otherTo}
        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-zinc-900 hover:bg-zinc-50"
      >
        前往查看「{otherName}」策略說明 →
      </a>

      <p className="text-sm leading-relaxed text-zinc-600">
        兩個策略的選股邏輯完全不同（一個追成長動能、一個追穩健殖利率），最慘的時候通常不會剛好是同一段時間。
        下面用兩策略各自已經回測好的月報酬率，依固定比例混合、<strong className="font-semibold text-zinc-700">每年1月初重新平衡</strong>回目標比例，
        模擬同時持有兩個策略的效果——重點不是哪個比例最賺，而是混合後的風險（最大回撤、波動率）能不能比單押任何一邊都更低。
      </p>

      {!combo ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-400">
          此策略尚未提供合併持有模擬資料
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              動態多因子 / 高息低波 比例
            </div>
            <div className="flex gap-1.5">
              {COMBO_RATIOS.map((r) => (
                <button key={r.key} type="button" onClick={() => setRatio(r.key)} className={pill(ratio === r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">指標</th>
                  <th className="px-4 py-2.5 font-medium">動態多因子</th>
                  <th className="px-4 py-2.5 font-medium">高息低波</th>
                  <th className="px-4 py-2.5 font-medium text-violet-700">混合（{blend?.label}）</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600">年化報酬</td>
                  <td className={`px-4 py-2.5 font-semibold ${toneClass(dynamicOverview?.annual_return_all)}`}>{fmtPct(dynamicOverview?.annual_return_all)}</td>
                  <td className={`px-4 py-2.5 font-semibold ${toneClass(highDivOverview?.annual_return_all)}`}>{fmtPct(highDivOverview?.annual_return_all)}</td>
                  <td className={`px-4 py-2.5 font-bold ${toneClass(blend?.annual_return)}`}>{fmtPct(blend?.annual_return)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600">最大回撤</td>
                  <td className="px-4 py-2.5 font-semibold text-red-600">{fmtPct(dynamicOverview?.max_drawdown)}</td>
                  <td className="px-4 py-2.5 font-semibold text-red-600">{fmtPct(highDivOverview?.max_drawdown)}</td>
                  <td className="px-4 py-2.5 font-bold text-red-600">{fmtPct(blend?.max_drawdown)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.volatility}>年化波動率</TermLabel></td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtMagnitudePct(dynamicOverview?.volatility_all)}</td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtMagnitudePct(highDivOverview?.volatility_all)}</td>
                  <td className="px-4 py-2.5 font-bold text-zinc-900">{fmtMagnitudePct(blend?.volatility)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.sharpe}>夏普比率</TermLabel></td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(dynamicOverview?.sharpe_ratio)}</td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(highDivOverview?.sharpe_ratio)}</td>
                  <td className="px-4 py-2.5 font-bold text-zinc-900">{fmtRatio(blend?.sharpe_ratio)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.sortino}>Sortino 比率</TermLabel></td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(dynamicOverview?.sortino_ratio)}</td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(highDivOverview?.sortino_ratio)}</td>
                  <td className="px-4 py-2.5 font-bold text-zinc-900">{fmtRatio(blend?.sortino_ratio)}</td>
                </tr>
                <tr>
                  <td className="px-4 py-2.5 text-zinc-600"><TermLabel hint={TERM_HINTS.calmar}>Calmar 比率</TermLabel></td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(dynamicOverview?.calmar_ratio)}</td>
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{fmtRatio(highDivOverview?.calmar_ratio)}</td>
                  <td className="px-4 py-2.5 font-bold text-zinc-900">{fmtRatio(blend?.calmar_ratio)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-400">
            混合欄位為事後用月報酬率近似模擬的結果，非重新執行聯合部位回測，數字會跟兩策略各自頁面顯示的精確逐日回測結果略有差異。
          </p>

          {yearlyChartData.length > 0 ? (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
                混合（{blend?.label}）逐年報酬
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={yearlyChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                    <XAxis dataKey="year" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${v}%`} />
                    <Tooltip content={<ComboYearlyTooltip />} cursor={{ fill: '#f4f4f5' }} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function getSections(strategyId) {
  const comboTitle =
    strategyId === '2'
      ? '與動態多因子搭配'
      : '與高息低波搭配'

  return [
    { id: 'intro', title: '策略完整介紹' },
    { id: 'flowchart', title: '選股流程圖' },
    { id: 'factors', title: '因子說明' },
    { id: 'usage', title: '應用方法' },
    { id: 'backtest', title: '完整回測數值' },
    { id: 'validation', title: '策略驗證' },
    { id: 'combo', title: comboTitle },
    { id: 'disclaimer', title: '免責聲明' },
  ]
}

function getStrategyName(id) {
  return STRATEGY_ENTRIES.find((s) => s.id === id)?.name ?? `策略${id}`
}

function getSectionContent(sectionId, strategyId) {
  if (sectionId === 'intro' && strategyId === '1') {
  return (
    <div className="space-y-4 leading-relaxed text-zinc-700">
      <p>
        本策略屬於<strong>高波動、高潛在報酬</strong>的選股方法。回測顯示<strong>長期績效表現突出</strong>，但相對也伴隨較大的<strong>短期波動與回撤</strong>，適合能承受較高風險、追求較高報酬的投資人。
      </p>

      <p>
        回測已納入<strong>交易成本</strong>，包含手續費 <strong>0.1425%</strong> 與證券交易稅 <strong>0.3%</strong>（未計算券商折扣）。儘管如此，實際交易仍可能面臨<strong>滑價問題</strong>。若資金規模較大、且集中在單一時點大量買入，長期報酬可能因<strong>流動性與衝擊成本</strong>而有所縮減。
      </p>

      <p>
        本策略完全<strong>未使用人工智慧或機器學習</strong>，僅採用相對簡單、可解釋的數學邏輯，並且刻意<strong>不進行精細的參數微調</strong>，以降低<strong>過度擬合</strong>的風險。設計上優先追求<strong>規則透明與可長期執行</strong>，而非追求短期最佳化的複雜模型。
      </p>

      <p>
        另外，策略會依<strong>大盤狀態</strong>調整選股方向，並採<strong>季度再平衡</strong>，以減少頻繁交易。它<strong>不保證</strong>在所有市場環境下都能穩定獲利，投資人仍需自行評估風險承受能力。
      </p>

      <p className="text-zinc-500">
        點擊下方「選股流程圖」與「因子說明」可進一步了解細節。
      </p>
    </div>
  )
}
if (sectionId === 'intro' && strategyId === '2') {
  return (
    <div className="space-y-4 leading-relaxed text-zinc-700">
      <p>
        本策略屬於<strong>低波動、穩健收息</strong>的選股方法。回測顯示<strong>波動度明顯低於大盤與動態多因子策略</strong>，年化報酬雖然不是三者中最高，但<strong>最大回撤也相對輕微</strong>，適合風險承受度較低、偏好穩定持有的投資人。
      </p>

      <p>
        回測已納入<strong>交易成本</strong>，包含手續費 <strong>0.1425%</strong> 與證券交易稅 <strong>0.3%</strong>（未計算券商折扣）。儘管如此，實際交易仍可能面臨<strong>滑價問題</strong>。若資金規模較大、且集中在單一時點大量買入，長期報酬可能因<strong>流動性與衝擊成本</strong>而有所縮減。
      </p>

      <p>
        本策略完全<strong>未使用人工智慧或機器學習</strong>，僅採用相對簡單、可解釋的數學邏輯，並且刻意<strong>不進行精細的參數微調</strong>，以降低<strong>過度擬合</strong>的風險。設計上優先追求<strong>規則透明與可長期執行</strong>，而非追求短期最佳化的複雜模型。
      </p>

      <p>
        跟動態多因子策略不同，本策略<strong>不區分牛熊市場</strong>，因子權重固定不變，選股邏輯單純許多；另外設有<strong>金融股上限（最多4檔）</strong>，避免高股息篩選機制過度集中在金融股。同樣採<strong>季度再平衡</strong>，<strong>不保證</strong>在所有市場環境下都能穩定獲利，投資人仍需自行評估風險承受能力。
      </p>

      <p className="text-zinc-500">
        點擊下方「選股流程圖」與「因子說明」可進一步了解細節。
      </p>
    </div>
  )
}
if (sectionId === 'flowchart' && strategyId === '1') {
  return (
    <div className="relative pl-8">
      {/* 左側垂直線 */}
      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-zinc-200"></div>

      <div className="space-y-6">
        {/* Step 1 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            1
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">大盤狀態判斷</div>
            <div className="mt-1 text-sm text-zinc-600">
              使用簡單均線邏輯，判斷目前為多頭或空頭環境
            </div>
          </div>
        </div>

        {/* Step 2 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            2
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">基本條件過濾</div>
            <div className="mt-1 text-sm text-zinc-600">通過以下條件才進入評分：</div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• 營收為正</li>
              <li>• PEG 介於合理區間</li>
              <li>• 季均營收創新高</li>
              <li>• 營收資料足夠</li>
              <li>• 均線呈多頭排列</li>
              <li>• 流動性足夠</li>
            </ul>
          </div>
        </div>

        {/* Step 3 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            3
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">多因子評分</div>
            <div className="mt-1 text-sm text-zinc-600">依市場狀態使用不同因子組合：</div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• 牛市：RS（動能）+ PEG（成長估值）+ DD（下行風險）</li>
              <li>• 熊市：RS（動能）+ Corr（與大盤相關性）+ DD（下行風險）</li>
            </ul>
          </div>
        </div>

        {/* Step 4 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            4
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">選出股票並建立部位</div>
            <div className="mt-1 text-sm text-zinc-600">
              依評分排序選股：
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• 牛市：選取得分最高的 <strong>16</strong> 檔</li>
              <li>• 熊市：選取得分最高的 <strong>5</strong> 檔</li>
            </ul>
            <div className="mt-2 text-sm text-zinc-600">
              並處理 T+1 限制
              <br />
              （例如：1/1 選出股票，1/2 才實際換股）
            </div>
          </div>
        </div>

        {/* Step 5 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            5
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">季度再平衡</div>
            <div className="mt-1 text-sm text-zinc-600">
              每季進行一次調整
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
if (sectionId === 'flowchart' && strategyId === '2') {
  return (
    <div className="relative pl-8">
      {/* 左側垂直線 */}
      <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-zinc-200"></div>

      <div className="space-y-6">
        {/* Step 1 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            1
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">基本條件過濾</div>
            <div className="mt-1 text-sm text-zinc-600">通過以下三大濾網才進入評分：</div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• 殖利率落在合理區間（避免過低沒吸引力、過高恐為財報異常的價值陷阱）</li>
              <li>• 成交金額足夠（流動性足夠）</li>
              <li>• 股價站上年線</li>
            </ul>
          </div>
        </div>

        {/* Step 2 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            2
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">雙因子評分</div>
            <div className="mt-1 text-sm text-zinc-600">
              不分牛熊市場，固定用同一組權重，以低波動為主、高殖利率為輔：
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• STD（低波動）</li>
              <li>• DY（高殖利率）</li>
            </ul>
          </div>
        </div>

        {/* Step 3 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            3
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">選股並建立部位</div>
            <div className="mt-1 text-sm text-zinc-600">
              依評分排序，選出最高分的 <strong>12</strong> 檔，等權重持有：
            </div>
            <ul className="mt-2 space-y-1 text-sm text-zinc-600">
              <li>• 金融股最多 <strong>4</strong> 檔（避免高股息篩選過度集中在金融業）</li>
              <li>• 若非金融股不足額，放寬限制用剩餘金融股補滿 12 檔</li>
            </ul>
          </div>
        </div>

        {/* Step 4 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            4
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">T+1 限制處理</div>
            <div className="mt-1 text-sm text-zinc-600">
              若訊號隔日開盤已接近漲停、買不到，則延續原有部位，不強行追價
            </div>
          </div>
        </div>

        {/* Step 5 */}
        <div className="relative">
          <div className="absolute -left-8 top-3 h-6 w-6 rounded-full border-2 border-zinc-300 bg-white flex items-center justify-center text-xs font-semibold text-zinc-600">
            5
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-sm font-semibold text-zinc-900">季度再平衡</div>
            <div className="mt-1 text-sm text-zinc-600">
              每季進行一次調整
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
if (sectionId === 'factors' && strategyId === '1') {
  return (
    <div className="space-y-4 text-sm text-zinc-700">
      <p>
        本策略會依大盤狀態切換使用的因子組合：
      </p>

      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">市場狀態</th>
              <th className="px-4 py-3 font-medium">使用因子</th>
              <th className="px-4 py-3 font-medium">說明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <tr className="bg-white">
              <td className="px-4 py-3 font-semibold text-zinc-900" rowSpan={3}>
                牛市
              </td>
              <td className="px-4 py-3">RS（動能）</td>
              <td className="px-4 py-3 text-zinc-600">捕捉相對強勢的股票</td>
            </tr>
            <tr className="bg-white">
              <td className="px-4 py-3">PEG（成長估值）</td>
              <td className="px-4 py-3 text-zinc-600">兼顧成長性與估值合理性</td>
            </tr>
            <tr className="bg-white">
              <td className="px-4 py-3">DD（下行風險）</td>
              <td className="px-4 py-3 text-zinc-600">降低大幅回撤的個股權重</td>
            </tr>
            <tr className="bg-zinc-50/50">
              <td className="px-4 py-3 font-semibold text-zinc-900" rowSpan={3}>
                熊市
              </td>
              <td className="px-4 py-3">RS（動能）</td>
              <td className="px-4 py-3 text-zinc-600">仍保留相對強勢標的</td>
            </tr>
            <tr className="bg-zinc-50/50">
              <td className="px-4 py-3">Corr（與大盤相關性）</td>
              <td className="px-4 py-3 text-zinc-600">優先選擇與大盤連動較低的股票</td>
            </tr>
            <tr className="bg-zinc-50/50">
              <td className="px-4 py-3">DD（下行風險）</td>
              <td className="px-4 py-3 text-zinc-600">持續控制下行波動</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-zinc-600">
        這樣設計的目的，是在多頭環境較重視成長與動能，空頭環境則增加防禦性考量。
      </p>
    </div>
  )
}
if (sectionId === 'factors' && strategyId === '2') {
  return (
    <div className="space-y-4 text-sm text-zinc-700">
      <p>
        本策略不分牛熊市場，固定使用同一組因子：
      </p>

      <div className="overflow-x-auto rounded-xl border border-zinc-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600">
            <tr>
              <th className="px-4 py-3 font-medium">因子</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">說明</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            <tr className="bg-white">
              <td className="px-4 py-3 font-semibold text-zinc-900">STD（低波動）</td>
              <td className="px-4 py-3">主要因子</td>
              <td className="px-4 py-3 text-zinc-600">報酬標準差越低分數越高，優先選擇股價相對穩定的股票</td>
            </tr>
            <tr className="bg-zinc-50/50">
              <td className="px-4 py-3 font-semibold text-zinc-900">DY（高殖利率）</td>
              <td className="px-4 py-3">輔助因子</td>
              <td className="px-4 py-3 text-zinc-600">股息殖利率排名越高分數越高，但只取合理區間內的股票</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-zinc-600">
        這樣設計的目的，是把「低波動」當成主要選股依據，「高殖利率」則作為輔助篩選與加分，
        避免只挑殖利率最高、但股價也最不穩定的個股。
      </p>
    </div>
  )
}
if (sectionId === 'usage' && strategyId === '1') {
  return (
    <div className="space-y-5 text-sm text-zinc-700 leading-relaxed">
      {/* 網站功能 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">一、網站功能</div>
        <ul className="space-y-1.5">
          <li>• 點擊欄位可進行排序</li>
          <li>• 點擊分數或通過／未通過圖示，可查看近五日分數變化與濾網通過情形</li>
          <li>• 點擊股票名稱可跳轉至 TradingView</li>
        </ul>
      </div>

      {/* 使用方式 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">二、使用方式</div>

        <div className="space-y-4">
          <div>
            <div className="font-medium text-zinc-900">1. 跟單者</div>
            <p className="mt-1 text-zinc-600">
              關注換倉日。建議於換倉前一日，在「條件篩選」排名中確認前 16 檔（牛市）或前 5 檔（熊市），於換倉當日進行調整。
            </p>
          </div>

          <div>
            <div className="font-medium text-zinc-900">2. 二次選股者</div>
            <p className="mt-1 text-zinc-600">
              可使用條件篩選中的排序功能，搭配 TradingView 進行自主選股與判斷。
            </p>
          </div>

          <div>
            <div className="font-medium text-zinc-900">3. 研究者</div>
            <p className="mt-1 text-zinc-600">
              可檢視全市場股票（無論是否通過濾網），包含營收為負的轉機股。例如在全市場排名中點擊 PEG 兩次進行排序，深入研究。
            </p>
          </div>
        </div>
      </div>

      {/* 補充說明 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">三、補充說明</div>
        <p className="text-zinc-600">
          跟單者也可自行選擇其他換倉日，但若依照策略的換倉時點操作，較能減少與回測結果的差異。
        </p>
      </div>
    </div>
  )
}
if (sectionId === 'usage' && strategyId === '2') {
  return (
    <div className="space-y-5 text-sm text-zinc-700 leading-relaxed">
      {/* 網站功能 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">一、網站功能</div>
        <ul className="space-y-1.5">
          <li>• 點擊欄位可進行排序</li>
          <li>• 點擊分數或通過／未通過圖示，可查看近五日分數變化與濾網通過情形</li>
          <li>• 點擊股票名稱可跳轉至 TradingView</li>
        </ul>
      </div>

      {/* 使用方式 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">二、使用方式</div>

        <div className="space-y-4">
          <div>
            <div className="font-medium text-zinc-900">1. 跟單者</div>
            <p className="mt-1 text-zinc-600">
              關注換倉日。建議於換倉前一日，在「條件篩選」排名中確認前 12 檔（不分牛熊，固定持股數），於換倉當日進行調整。
            </p>
          </div>

          <div>
            <div className="font-medium text-zinc-900">2. 二次選股者</div>
            <p className="mt-1 text-zinc-600">
              可使用條件篩選中的排序功能，搭配 TradingView 進行自主選股與判斷。
            </p>
          </div>

          <div>
            <div className="font-medium text-zinc-900">3. 研究者</div>
            <p className="mt-1 text-zinc-600">
              可檢視全市場股票（無論是否通過濾網）。例如在全市場排名中點擊 DY（殖利率）兩次進行排序，觀察不同殖利率區間的個股分布。
            </p>
          </div>
        </div>
      </div>

      {/* 補充說明 */}
      <div>
        <div className="font-semibold text-zinc-900 mb-2">三、補充說明</div>
        <p className="text-zinc-600">
          跟單者也可自行選擇其他換倉日，但若依照策略的換倉時點操作，較能減少與回測結果的差異。金融股持股上限為 4 檔，若持股中金融股已達上限，換倉時請留意這項限制。
        </p>
      </div>
    </div>
  )
}
if (sectionId === 'backtest') {
  return <BacktestOverviewSection strategyId={strategyId} />
}
if (sectionId === 'validation') {
  return <StrategyValidationSection strategyId={strategyId} />
}
if (sectionId === 'disclaimer') {
  const strategyName = getStrategyName(strategyId)
  return (
    <div className="space-y-4 text-sm leading-relaxed text-zinc-700">
      <p>
        本頁所有排名、分數、回測績效與統計驗證（含蒙地卡羅模擬、分數與報酬率驗證等），
        <strong className="font-semibold text-zinc-900">僅為歷史資料之量化研究與模擬結果，不代表、也不保證未來績效</strong>，
        更<strong className="font-semibold text-zinc-900">不構成任何形式的投資建議、推介或勸誘</strong>。
      </p>

      <p>
        回測已計入手續費（0.1425%）與證券交易稅（0.3%），但<strong className="font-semibold text-zinc-900">未完全反映真實交易中的滑價、實際成交價差、以及資金規模較大時的市場衝擊成本</strong>。
        實際依照本頁「{strategyName}」規則進行交易的結果，可能與回測數字有落差。
      </p>

      <p>
        市場環境、公司基本面、總體經濟情勢隨時可能改變，過去有效的選股邏輯<strong className="font-semibold text-zinc-900">未來不一定持續有效</strong>，策略也可能因此失效或表現不如預期。
      </p>

      <p>
        股票資料來源為 FinLab，每個交易日盤後更新一次，可能因假日、資料延遲或來源異常等因素而有誤差；請以官方公開資訊為準，交易前務必自行查證。
      </p>

      <p className="text-zinc-500">
        使用本頁資訊進行任何投資決策，須由使用者自行判斷、自負盈虧，本網站不對因此產生的任何損失負責。
      </p>
    </div>
  )
}
if (sectionId === 'combo') {
  return <ComboSection strategyId={strategyId} />
}
  return '此區塊內容待補充'

}

function AccordionItem({ section, isOpen, onToggle, strategyId }) {
  const panelId = `strategy-info-${section.id}`
  const buttonId = `${panelId}-trigger`

  return (
    <div
      data-accordion-item
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
    >
      <button
        id={buttonId}
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 sm:px-5 sm:text-base"
      >
        <span>{section.title}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
          aria-hidden="true"
        />
      </button>

      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={buttonId}
          className="border-t border-zinc-100 px-4 py-4 text-sm text-zinc-600 sm:px-5"
        >
          {getSectionContent(section.id, strategyId)}
        </div>
      ) : null}
    </div>
  )
}

export default function StrategyInfoPage() {
  const { id } = useParams()
  const strategyName = getStrategyName(id)
  const sections = getSections(id)
  const [openIds, setOpenIds] = useState(() => new Set())

  useEffect(() => {
  const handleClickOutside = (e) => {
    const isInsideAccordion = e.target.closest('[data-accordion-item]')
    if (!isInsideAccordion) {
      setOpenIds(new Set())
    }
  }

  document.addEventListener('click', handleClickOutside)
  return () => document.removeEventListener('click', handleClickOutside)
}, [])
  const toggleSection = (sectionId) => {
  const willClose = openIds.has(sectionId)
  setOpenIds(willClose ? new Set() : new Set([sectionId]))

  // 展開：讓該區塊標題捲到接近頂部；收合：回到頁面最上方的大標題
  setTimeout(() => {
    const targetId = willClose ? 'strategy-info-page-title' : `strategy-info-${sectionId}-trigger`
    const el = document.getElementById(targetId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, 50)
}

  return (
    <AppSidebarLayout contentClassName="max-w-[960px] mx-auto">
      <div className="space-y-4 sm:space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div id="strategy-info-page-title" className="text-lg font-semibold sm:text-xl scroll-mt-4">
              {strategyName} 策略說明
            </div>
            <div className="mt-1 text-xs text-zinc-600 sm:text-sm">
              點擊區塊標題展開內容
            </div>
          </div>
          <Link
            to={`/strategy/${id}`}
            className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
          >
            返回策略
          </Link>
        </div>

        <div className="space-y-3">
          {sections.map((section) => (
            <AccordionItem
              key={section.id}
              section={section}
              isOpen={openIds.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              strategyId={id}
            />
          ))}
        </div>

        {/* 墊底空間：讓排在清單最後面的區塊（搭配、免責聲明等）展開時也有足夠捲動空間，
            能把標題捲到畫面最上緣，不會因為頁面剩餘高度不夠而卡住捲不動 */}
        <div className="h-[70vh]" aria-hidden="true" />
      </div>
    </AppSidebarLayout>
  )
}
