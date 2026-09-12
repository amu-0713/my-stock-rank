// src/pages/Home.jsx
// 「訊號 Signal」深色新版首頁 —— 監控清單 + 聚焦詳情的主控台版面
// （不是「兩張一樣的卡片並排」，而是左邊策略監控清單、右邊放大顯示點進去的那支策略）。
// 功能跟舊版 HomePage.jsx 完全對齊：雙策略、期間切換圖表、策略說明彈窗、
// 換倉至今表現連結、更新時間、免責聲明，一項都沒少，只是版面重新規劃過。
// 舊檔案保留未動，App.jsx 切換路由即可互換。
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { Info, X } from 'lucide-react'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

const PERIODS = ['今年', '1年', '5年', '全部']
const UP = '#f0475c'
const DOWN = '#2fbf71'

// 台股慣例：紅漲綠跌，跟排名頁/換倉至今表現同一套語意
function toneClass(v) {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return 'text-signal-text'
  return v > 0 ? 'text-signal-up' : 'text-signal-down'
}
function signedPct(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

// 用今年走勢的真實資料畫監控清單上的迷你走勢圖，不是裝飾用的假線
function sparkPoints(series, width = 56, height = 24) {
  if (!series?.length) return ''
  const step = Math.max(1, Math.floor(series.length / 24))
  const pts = series.filter((_, i) => i % step === 0)
  const values = pts.map(p => p.returns)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return pts
    .map((p, i) => {
      const x = (i / (pts.length - 1 || 1)) * width
      const y = height - ((p.returns - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const CustomFinalLabel = (props) => {
  const { x, y, value, index, data } = props
  if (!data || index !== data.length - 1) return null
  return (
    <g>
      <circle cx={x} cy={y} r={4} fill="#4cc9f0" />
      <text x={x - 5} y={y - 12} fill="#4cc9f0" fontSize={12} fontWeight="700" textAnchor="end" fontFamily="IBM Plex Mono, monospace">
        {signedPct(value)}
      </text>
    </g>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const strategy = payload.find(p => p.dataKey === 'returns')
  const benchmark = payload.find(p => p.dataKey === 'benchmark')
  return (
    <div className="min-w-[150px] rounded-lg border border-signal-border bg-signal-surface-2 p-3 shadow-xl font-signal-body">
      <p className="mb-2 border-b border-signal-border-soft pb-1 text-[11px] text-signal-text-faint">{payload[0].payload.date}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-signal-text-dim">策略</span>
          <span className={`font-signal-mono text-sm font-bold ${toneClass(strategy?.value)}`}>{signedPct(strategy?.value)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs font-medium text-signal-text-faint">大盤</span>
          <span className={`font-signal-mono text-sm font-bold ${toneClass(benchmark?.value)}`}>{signedPct(benchmark?.value)}</span>
        </div>
      </div>
    </div>
  )
}

// ============ 左側：策略監控清單（點了切換右邊聚焦哪一支） ============
function WatchRow({ entry, tagline, overview, chartToday, active, isLoading, onSelect }) {
  const ytd = overview?.total_return_ytd
  const points = sparkPoints(chartToday)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition ${
        active
          ? 'border-signal-accent/50 bg-signal-surface-2'
          : 'border-transparent hover:border-signal-border-soft hover:bg-signal-surface-2/50'
      }`}
    >
      <span className={`h-8 w-[3px] shrink-0 rounded-full ${active ? 'bg-signal-accent' : 'bg-transparent'}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate font-signal-display text-[13.5px] font-semibold text-signal-text">{entry.name}</div>
        <div className="truncate text-[11px] text-signal-text-faint">{tagline}</div>
      </div>
      <svg width="52" height="22" viewBox="0 0 56 24" preserveAspectRatio="none" className="shrink-0">
        <polyline points={points} fill="none" stroke={ytd >= 0 ? UP : DOWN} strokeWidth="1.6" />
      </svg>
      <div className={`w-14 shrink-0 text-right font-signal-mono text-[13px] font-semibold ${isLoading ? 'text-signal-text-faint' : toneClass(ytd)}`}>
        {isLoading ? '···' : signedPct(ytd)}
      </div>
    </button>
  )
}

function StatCell({ label, value, tone }) {
  return (
    <div className="flex-1 px-4 py-3 text-center first:pl-1 last:pr-1">
      <div className="text-[10px] tracking-wide text-signal-text-faint">{label}</div>
      <div className={`mt-1 font-signal-mono text-[18px] font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}

// ============ 右側：聚焦中策略的詳細面板 ============
function DetailPanel({
  entry, tagline, overview = {}, latestDate, chartData,
  selectedPeriod, onPeriodChange, onOpenInfo, isLoading,
}) {
  const currentData = chartData ? chartData[selectedPeriod] : []
  const endYear = latestDate ? new Date(latestDate).getFullYear() : '2026'

  const [isChangingPeriod, setIsChangingPeriod] = useState(false)
  const handlePeriodChange = (period) => {
    if (period === selectedPeriod) return
    setIsChangingPeriod(true)
    onPeriodChange(period)
    setTimeout(() => setIsChangingPeriod(false), 180)
  }
  const showLoading = isLoading || isChangingPeriod

  return (
    <div className="flex h-full flex-col rounded-xl border border-signal-border bg-signal-surface p-5 font-signal-body sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-signal-display text-[19px] font-semibold text-signal-text">{entry.name}</h3>
            <button
              type="button"
              onClick={onOpenInfo}
              className="rounded-md border border-signal-border bg-signal-surface-2 p-1 text-signal-text-dim transition hover:border-signal-accent/50 hover:text-signal-accent"
              title="策略介紹"
            >
              <Info size={13} />
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-signal-text-dim">{tagline} · 回測 2010–{endYear}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            to={`/strategy/${entry.id}/rebalance`}
            className="whitespace-nowrap rounded-md border border-signal-border px-3 py-1.5 text-[12.5px] font-medium text-signal-text-dim transition hover:border-signal-accent/40 hover:text-signal-accent"
          >
            換倉至今表現
          </Link>
          <Link
            to={entry.to}
            className="whitespace-nowrap rounded-md border border-signal-accent/60 bg-signal-accent/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-signal-accent transition hover:bg-signal-accent/20"
          >
            進入策略
          </Link>
        </div>
      </div>

      <div className="mt-4 flex gap-1.5">
        {PERIODS.map(period => (
          <button
            key={period}
            type="button"
            onClick={() => handlePeriodChange(period)}
            className={`flex-1 rounded-md py-1.5 text-[12.5px] font-medium transition ${
              selectedPeriod === period
                ? 'bg-signal-accent/15 text-signal-accent ring-1 ring-inset ring-signal-accent/40'
                : 'bg-signal-surface-2 text-signal-text-dim hover:text-signal-text'
            }`}
          >
            {period}
          </button>
        ))}
      </div>

      <div className="relative mt-3 h-[260px] overflow-hidden rounded-lg border border-signal-border-soft bg-signal-bg/40 sm:h-[300px]">
        {showLoading ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-signal-text-faint">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-signal-border border-t-signal-accent" />
            <span className="text-[12px]">{isLoading ? '載入中…' : '切換期間…'}</span>
          </div>
        ) : chartData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={currentData} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${entry.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4cc9f0" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#4cc9f0" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#1b2029" />
              <XAxis
                dataKey="date" axisLine={false} tickLine={false}
                tick={{ fill: '#5b6272', fontSize: 10.5 }}
                interval={0} padding={{ left: 16, right: 26 }}
                tickFormatter={(str, index) => {
                  const currDate = new Date(str)
                  const currYear = currDate.getFullYear()
                  const currMonth = currDate.getMonth() + 1
                  const prevData = currentData[index - 1]
                  const prevDate = prevData ? new Date(prevData.date) : null
                  const isNewYear = prevDate ? currYear !== prevDate.getFullYear() : true
                  const isNewMonth = prevData ? currMonth !== (prevDate.getMonth() + 1) : true
                  if (selectedPeriod === '今年') { if (isNewMonth && currMonth % 2 !== 0) return `${currMonth}月` }
                  else if (selectedPeriod === '1年') { if (isNewMonth && (currMonth - 1) % 3 === 0) return `${currYear}/${currMonth}` }
                  else if (selectedPeriod === '5年') { if (isNewYear && currYear % 2 === 0) return `${currYear}` }
                  else if (selectedPeriod === '全部') { if (isNewYear && currYear % 5 === 0) return `${currYear}` }
                  return ''
                }}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip content={<CustomTooltip />} trigger="axis" shared defaultIndex={currentData?.length - 1} wrapperStyle={{ visibility: 'visible', pointerEvents: 'none' }} />
              <Area type="monotone" dataKey="benchmark" stroke="#3a3f4b" strokeWidth={1.5} strokeDasharray="4 4" fill="transparent" isAnimationActive={false} dot={false} connectNulls />
              <Area
                type="monotone" dataKey="returns" stroke="#4cc9f0" strokeWidth={2.25} fillOpacity={1}
                fill={`url(#grad-${entry.id})`} isAnimationActive={false}
                label={<CustomFinalLabel data={currentData} />} activeDot={{ r: 4, strokeWidth: 0, fill: '#4cc9f0' }} connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[12.5px] text-signal-text-faint">數據載入中…</div>
        )}
      </div>

      <div className="mt-4 flex divide-x divide-signal-border-soft rounded-lg border border-signal-border-soft bg-signal-surface-2">
        <StatCell label="年化報酬" value={signedPct(overview.annual_return_all)} tone={toneClass(overview.annual_return_all)} />
        <StatCell label="最大回撤" value={signedPct(overview.max_drawdown)} tone={toneClass(overview.max_drawdown)} />
        <StatCell label="夏普比率" value={overview.sharpe_ratio?.toFixed(2) ?? '—'} tone="text-signal-accent" />
        <StatCell label="今年報酬" value={signedPct(overview.total_return_ytd)} tone={toneClass(overview.total_return_ytd)} />
      </div>
    </div>
  )
}

function InfoModal({ strategyName, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-signal-border bg-signal-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-signal-border-soft bg-signal-surface-2 px-5 py-3.5">
          <h3 className="font-signal-display text-[14.5px] font-semibold text-signal-text">「{strategyName}」策略邏輯</h3>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-signal-text-dim transition hover:bg-signal-surface hover:text-signal-text">
            <X size={17} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 font-signal-body text-[13.5px] leading-relaxed text-signal-text-dim">
          {children}
        </div>
        <div className="shrink-0 border-t border-signal-border-soft p-3.5">
          <button type="button" onClick={onClose} className="w-full rounded-lg bg-signal-accent py-2.5 font-signal-body text-[13.5px] font-semibold text-signal-bg transition hover:opacity-90">
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}

const HOME_STRATEGY_CONFIG = {
  '1': { resultUrl: '/result.json', chartUrl: '/chart_data.json', tagline: '偏進取與動態選股' },
  '2': { resultUrl: '/result_2.json', chartUrl: '/chart_data_2.json', tagline: '偏穩健與風險控制' },
}

export default function Home() {
  const [strategyData, setStrategyData] = useState({})
  const [chartByStrategy, setChartByStrategy] = useState({})
  const [selectedPeriodByStrategy, setSelectedPeriodByStrategy] = useState({ '1': '今年', '2': '今年' })
  const [infoModalId, setInfoModalId] = useState(null)
  const [loadingByStrategy, setLoadingByStrategy] = useState({ '1': true, '2': true })
  const [activeId, setActiveId] = useState(STRATEGY_ENTRIES[0]?.id ?? '1')

  useEffect(() => {
    Object.entries(HOME_STRATEGY_CONFIG).forEach(([id, config]) => {
      (async () => {
        setLoadingByStrategy(prev => ({ ...prev, [id]: true }))
        try {
          const [resultRes, chartRes] = await Promise.all([
            fetch(config.resultUrl, { cache: 'no-store' }),
            fetch(config.chartUrl, { cache: 'no-store' }),
          ])
          const resultJson = resultRes.ok ? await resultRes.json() : null
          const chartJson = chartRes.ok ? await chartRes.json() : null
          if (resultJson) setStrategyData(prev => ({ ...prev, [id]: resultJson }))
          if (chartJson) setChartByStrategy(prev => ({ ...prev, [id]: chartJson }))
        } catch (e) {
          console.error(`Loading strategy ${id} failed:`, e)
        } finally {
          setLoadingByStrategy(prev => ({ ...prev, [id]: false }))
        }
      })()
    })
  }, [])

  const primaryData = strategyData['1']
  const updatedLabel = primaryData?.updated_at
    ? primaryData.updated_at
    : (primaryData?.latest_date ? `${primaryData.latest_date} 晚上更新` : '載入中…')

  const activeEntry = useMemo(
    () => STRATEGY_ENTRIES.find(e => e.id === activeId) ?? STRATEGY_ENTRIES[0],
    [activeId],
  )

  return (
    <div className="min-h-screen bg-signal-bg font-signal-body text-signal-text">
      {/* ============ 頁首導覽 ============ */}
      <header className="sticky top-0 z-30 border-b border-signal-border-soft bg-signal-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-signal-border bg-signal-surface-2 font-signal-display text-[13px] font-bold text-signal-accent">Q</span>
            <span className="font-signal-display text-[14.5px] font-semibold tracking-wide">量化選股策略</span>
          </div>
          <nav className="hidden items-center gap-1 sm:flex">
            <a href="#top" className="rounded-md bg-signal-surface-2 px-3 py-1.5 text-[12.5px] font-medium text-signal-text">總覽</a>
            <a href="#meta" className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-signal-text-dim transition hover:text-signal-text">更新</a>
            <a href="#disclaimer" className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-signal-text-dim transition hover:text-signal-text">免責聲明</a>
          </nav>
          {/* 右上角預留給全站的 AuthMenu（fixed 定位，浮在最上層） */}
          <span className="w-16 sm:w-24" aria-hidden />
        </div>
      </header>

      <div id="top" className="mx-auto max-w-5xl px-5 pb-16 pt-6 sm:px-8 sm:pt-8">
        {/* ============ Hero：精簡成一行，把版面讓給下面的主控台 ============ */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
          <h1 className="font-signal-display text-[22px] font-semibold tracking-tight text-signal-text sm:text-[24px]">
            量化選股策略排名
          </h1>
          <div className="flex items-center gap-2 rounded-lg border border-signal-border-soft bg-signal-surface px-3 py-1.5 text-[11.5px] text-signal-text-faint">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-signal-down" />
            更新於 <span className="font-signal-mono text-signal-text-dim">{updatedLabel}</span>
          </div>
        </div>

        {/* ============ 主控台：左邊監控清單、右邊聚焦詳情 ============ */}
        <section id="strategies" className="scroll-mt-20">
          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            <div className="flex flex-col gap-1.5 rounded-xl border border-signal-border bg-signal-surface p-2 lg:p-2.5">
              <div className="px-2 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-signal-text-faint">
                策略監控
              </div>
              {STRATEGY_ENTRIES.map(entry => (
                <WatchRow
                  key={entry.id}
                  entry={entry}
                  tagline={HOME_STRATEGY_CONFIG[entry.id]?.tagline ?? entry.tagline}
                  overview={strategyData[entry.id]?.overview}
                  chartToday={chartByStrategy[entry.id]?.['今年']}
                  active={entry.id === activeEntry?.id}
                  isLoading={loadingByStrategy[entry.id]}
                  onSelect={() => setActiveId(entry.id)}
                />
              ))}
            </div>

            {activeEntry && (
              <DetailPanel
                entry={activeEntry}
                tagline={HOME_STRATEGY_CONFIG[activeEntry.id]?.tagline ?? activeEntry.tagline}
                overview={strategyData[activeEntry.id]?.overview}
                latestDate={strategyData[activeEntry.id]?.latest_date}
                chartData={chartByStrategy[activeEntry.id]}
                selectedPeriod={selectedPeriodByStrategy[activeEntry.id] ?? '今年'}
                onPeriodChange={period => setSelectedPeriodByStrategy(prev => ({ ...prev, [activeEntry.id]: period }))}
                onOpenInfo={() => setInfoModalId(activeEntry.id)}
                isLoading={loadingByStrategy[activeEntry.id]}
              />
            )}
          </div>
        </section>

        {infoModalId === '1' && (
          <InfoModal strategyName="動態多因子" onClose={() => setInfoModalId(null)}>
            <div className="space-y-4">
              <p>本策略為<span className="font-semibold text-signal-text">每季換股</span>的量化多因子模型。</p>
              <p>完全以<span className="font-semibold text-signal-text">固定邏輯規則</span>運作，不含人工主觀挑選，純粹由量化條件與數學模型驅動。</p>
              <p>先透過基本濾網篩選合格股票，再依牛熊市濾網判斷市場狀態，<span className="font-semibold text-signal-text">動態調整因子權重</span>進行排名。</p>
              <div className="pt-2">
                <p className="mb-3 font-medium text-signal-text">因子排名使用：</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-signal-border-soft bg-signal-surface-2 p-4">
                    <div className="mb-2 font-signal-display text-[12.5px] font-semibold text-signal-accent">牛市</div>
                    <div className="space-y-1.5 text-[13px]">
                      <div>· RS 相對強弱</div><div>· PEG 本益成長比</div><div>· DD 下行風險</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-signal-border-soft bg-signal-surface-2 p-4">
                    <div className="mb-2 font-signal-display text-[12.5px] font-semibold text-signal-accent">熊市</div>
                    <div className="space-y-1.5 text-[13px]">
                      <div>· RS 相對強弱</div><div>· Corr 低相關性</div><div>· DD 下行風險</div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="border-t border-signal-border-soft pt-4 text-[11.5px] text-signal-text-faint">
                點擊「進入策略」查看完整排名、持股明細與詳細選股邏輯
              </p>
            </div>
          </InfoModal>
        )}

        {infoModalId === '2' && (
          <InfoModal strategyName="高息低波" onClose={() => setInfoModalId(null)}>
            <div className="space-y-4">
              <p>本策略為<span className="font-semibold text-signal-text">每季換股</span>的量化高息低波模型。</p>
              <p>完全以<span className="font-semibold text-signal-text">固定邏輯規則</span>運作，不含人工主觀挑選，純粹由量化條件與數學模型驅動。</p>
              <p>先透過基本濾網篩選合格股票，再透過因子進行排名，同時<span className="font-semibold text-signal-text">限制金融股上限</span>。</p>
              <div className="pt-2">
                <p className="mb-3 font-medium text-signal-text">因子排名使用：</p>
                <div className="rounded-xl border border-signal-border-soft bg-signal-surface-2 p-4">
                  <div className="space-y-1.5 text-[13px]"><div>· DY 高殖利率</div><div>· STD 低波動率</div></div>
                </div>
              </div>
              <p className="border-t border-signal-border-soft pt-4 text-[11.5px] text-signal-text-faint">
                點擊「進入策略」查看完整排名、持股明細與詳細選股邏輯
              </p>
            </div>
          </InfoModal>
        )}

        {/* ============ 更新與免責聲明 ============ */}
        <section id="meta" className="mt-8 scroll-mt-20 rounded-xl border border-signal-border-soft bg-signal-surface px-5 py-4">
          <h2 className="font-signal-display text-[11px] font-semibold uppercase tracking-[0.12em] text-signal-text-faint">更新與聯絡</h2>
          <div className="mt-2.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[13px]">
            <span className="text-signal-text-faint">最近更新時間</span>
            <span className="font-signal-mono text-signal-text-dim">{updatedLabel}</span>
          </div>
        </section>

        <section id="disclaimer" className="mt-6 scroll-mt-20">
          <div className="rounded-xl border border-signal-border-soft bg-signal-surface px-5 py-4">
            <h2 className="font-signal-display text-[13px] font-semibold text-signal-text">免責聲明</h2>
            <p className="mt-2 text-[12.5px] leading-relaxed text-signal-text-dim">
              本頁資訊僅供研究與介面展示，不構成任何投資建議。實際決策請自行評估風險並確認資料來源與時效性。
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
