// src/pages/HomePage.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import { Info, X } from 'lucide-react'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

const PERIODS = ['今年', '1年', '5年', '全部']

const CustomFinalLabel = (props) => {
  const { x, y, value, stroke, index, data } = props
  if (!data || index !== data.length - 1) return null

  return (
    <g>
      <circle cx={x} cy={y} r={4} fill={stroke} />
      <text
        x={x - 5}
        y={y - 12}
        fill={stroke}
        fontSize={12}
        fontWeight="bold"
        textAnchor="end"
      >
        +{value.toFixed(1)}%
      </text>
    </g>
  )
}

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const strategy = payload.find(p => p.dataKey === 'returns')
    const benchmark = payload.find(p => p.dataKey === 'benchmark')

    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-md min-w-[140px]">
        <p className="text-[11px] text-zinc-500 mb-2 border-b pb-1">
          {payload[0].payload.date}
        </p>
        <div className="space-y-1.5">
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs text-emerald-600 font-medium">策略</span>
            <span className="text-sm font-bold text-emerald-600">
              {strategy?.value > 0 ? '+' : ''}{strategy?.value}%
            </span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <span className="text-xs text-zinc-400 font-medium">大盤</span>
            <span className="text-sm font-bold text-zinc-500">
              {benchmark?.value > 0 ? '+' : ''}{benchmark?.value}%
            </span>
          </div>
        </div>
      </div>
    )
  }
  return null
}

function StrategyHomeCard({
  entry,
  tagline,
  overview = {},
  latestDate,
  chartData,
  selectedPeriod,
  onPeriodChange,
  onOpenInfo,
  gradientId,
  isLoading,           // 初始資料載入
}) {
  const currentData = chartData ? chartData[selectedPeriod] : []
  const endYear = latestDate ? new Date(latestDate).getFullYear() : '2026'
  const displayTagline = tagline ?? entry.tagline

  // ==================== 新增：切換「今年 / 1年 / 5年 / 全部」時的 loading 效果 ====================
  const [isChangingPeriod, setIsChangingPeriod] = useState(false)

  const handlePeriodChange = (period) => {
    if (period === selectedPeriod) return
    setIsChangingPeriod(true)
    onPeriodChange(period)
    // 短暫顯示 loading（讓使用者感覺到切換動作，與 RankList 一致）
    setTimeout(() => {
      setIsChangingPeriod(false)
    }, 180)
  }

  // 初始 loading 或 期間切換 loading 時都顯示 spinner
  const showLoading = isLoading || isChangingPeriod

  if (showLoading) {
    return (
      <div className="group flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-zinc-900">{entry.name}</div>
            <p className="mt-1.5 text-sm leading-snug text-zinc-600">{displayTagline}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="p-2 rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 transition-colors"
            >
              <Info size={18} />
            </button>

            <Link
              to={entry.to}
              className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 whitespace-nowrap"
            >
              進入策略
            </Link>
          </div>
        </div>

        <p className="mt-3 text-sm text-zinc-500">
          回測期間：2010 - {endYear}
        </p>

        <div className="flex-1 flex flex-col items-center justify-center mt-8 mb-8">
          <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-600 rounded-full mb-4"></div>
          <div className="text-sm font-medium text-zinc-500">切換期間...</div>
        </div>

        <div className="grid grid-cols-2 gap-1.5 opacity-30 pointer-events-none">
          <div className="rounded-2xl bg-white border p-2.5">
            <div className="flex items-center gap-2 text-emerald-600">
              <span className="text-lg">📈</span>
              <span className="text-[16px] font-medium">年化報酬</span>
            </div>
            <div className="mt-2 text-[24px] font-bold text-emerald-600">—</div>
          </div>
          <div className="rounded-2xl bg-white border p-2.5">
            <div className="flex items-center gap-2 text-red-600">
              <span className="text-lg">📉</span>
              <span className="text-[16px] font-medium">最大回撤</span>
            </div>
            <div className="mt-2 text-[24px] font-bold text-red-600">—</div>
          </div>
          <div className="rounded-2xl bg-white border p-2.5">
            <div className="flex items-center gap-2 text-blue-600">
              <span className="text-lg">📊</span>
              <span className="text-[16px] font-medium">夏普比率</span>
            </div>
            <div className="mt-2 text-[24px] font-bold text-blue-600">—</div>
          </div>
          <div className="rounded-2xl bg-white border p-2.5">
            <div className="flex items-center gap-2 text-emerald-600">
              <span className="text-lg">📅</span>
              <span className="text-[16px] font-medium">今年報酬</span>
            </div>
            <div className="mt-2 text-[24px] font-bold text-emerald-600">—</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-zinc-900">{entry.name}</div>
          <p className="mt-1.5 text-sm leading-snug text-zinc-600">{displayTagline}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative group/info">
            <button
              type="button"
              onClick={onOpenInfo}
              className="p-2 rounded-full bg-zinc-100 text-zinc-500 hover:bg-zinc-200 transition-colors"
            >
              <Info size={18} />
            </button>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-zinc-800 text-white text-[10px] rounded opacity-0 group-hover/info:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
              策略介紹
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800" />
            </div>
          </div>

          <Link
            to={entry.to}
            className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 whitespace-nowrap"
          >
            進入策略
          </Link>
        </div>
      </div>

      <p className="mt-3 text-sm text-zinc-500">
        回測期間：2010 - {endYear}
      </p>

      <div className="mt-4 mb-4">
        <div className="flex gap-2">
          {PERIODS.map(period => (
            <button
              key={period}
              type="button"
              onClick={() => handlePeriodChange(period)}
              className={`px-4 py-1.5 text-sm font-medium rounded-xl transition flex-1 ${
                selectedPeriod === period
                  ? 'bg-zinc-900 text-white shadow'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {period}
            </button>
          ))}
        </div>
      </div>

      <div className="relative bg-zinc-50 border border-zinc-200 rounded-2xl h-[280px] mb-3 overflow-hidden">
        <div className="absolute top-4 left-6 z-10 pointer-events-none">
          <h3 className="text-lg font-bold text-zinc-700 flex items-center gap-1.5">
            策略 <span className="text-[20px] text-zinc-400 font-normal">vs.</span> 大盤績效
          </h3>
        </div>

        {chartData ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={currentData}
              margin={{ top: 45, right: 0, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
              <XAxis
                dataKey="date"
                hide={false}
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#52525b', fontSize: 11, fontWeight: 500 }}
                interval={0}
                padding={{ left: 20, right: 30 }}
                tickFormatter={(str, index) => {
                  const currDate = new Date(str)
                  const currYear = currDate.getFullYear()
                  const currMonth = currDate.getMonth() + 1
                  const prevData = currentData[index - 1]
                  const prevDate = prevData ? new Date(prevData.date) : null
                  const isNewYear = prevDate ? currYear !== prevDate.getFullYear() : true
                  const isNewMonth = prevData ? currMonth !== (prevDate.getMonth() + 1) : true
                  if (selectedPeriod === '今年') {
                    if (isNewMonth && currMonth % 2 !== 0) return `${currMonth}月`
                  } else if (selectedPeriod === '1年') {
                    if (isNewMonth && (currMonth - 1) % 3 === 0) return `${currYear}/${currMonth}`
                  } else if (selectedPeriod === '5年') {
                    if (isNewYear && currYear % 2 === 0) return `${currYear}`
                  } else if (selectedPeriod === '全部') {
                    if (isNewYear && currYear % 5 === 0) return `${currYear}`
                  }
                  return ''
                }}
              />
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Tooltip
                content={<CustomTooltip />}
                trigger="axis"
                shared
                defaultIndex={currentData?.length - 1}
                wrapperStyle={{ visibility: 'visible', pointerEvents: 'none' }}
              />
              <Area
                type="monotone"
                dataKey="benchmark"
                stroke="#71717a"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="transparent"
                isAnimationActive={false}
                dot={false}
                connectNulls
              />
              <Area
                type="monotone"
                dataKey="returns"
                stroke="#10b981"
                strokeWidth={2.5}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                label={<CustomFinalLabel data={currentData} />}
                activeDot={{ r: 5, strokeWidth: 0 }}
                connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center text-zinc-400 text-sm">
            數據載入中...
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <div className="rounded-2xl bg-white border p-2.5">
          <div className="flex items-center gap-2 text-emerald-600">
            <span className="text-lg">📈</span>
            <span className="text-[16px] font-medium">年化報酬</span>
          </div>
          <div className="mt-2 text-[24px] font-bold text-emerald-600">
            +{overview.annual_return_all?.toFixed(1) || '—'}%
          </div>
        </div>
        <div className="rounded-2xl bg-white border p-2.5">
          <div className="flex items-center gap-2 text-red-600">
            <span className="text-lg">📉</span>
            <span className="text-[16px] font-medium">最大回撤</span>
          </div>
          <div className="mt-2 text-[24px] font-bold text-red-600">
            {overview.max_drawdown?.toFixed(1) || '—'}%
          </div>
        </div>
        <div className="rounded-2xl bg-white border p-2.5">
          <div className="flex items-center gap-2 text-blue-600">
            <span className="text-lg">📊</span>
            <span className="text-[16px] font-medium">夏普比率</span>
          </div>
          <div className="mt-2 text-[24px] font-bold text-blue-600">
            {overview.sharpe_ratio?.toFixed(2) || '—'}
          </div>
        </div>
        <div className="rounded-2xl bg-white border p-2.5">
          <div className="flex items-center gap-2 text-emerald-600">
            <span className="text-lg">📅</span>
            <span className="text-[16px] font-medium">今年報酬</span>
          </div>
          <div className="mt-2 text-[24px] font-bold text-emerald-600">
            +{overview.total_return_ytd?.toFixed(1) || '—'}%
          </div>
        </div>
      </div>
    </div>
  )
}

function StrategyInfoModal({ strategyName, onClose, children }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center px-6 py-4 border-b border-zinc-100 bg-zinc-50 shrink-0">
          <h3 className="font-bold text-zinc-900">「 {strategyName} 」策略邏輯介紹</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 hover:bg-zinc-200 rounded-full transition-colors"
          >
            <X size={20} className="text-zinc-500" />
          </button>
        </div>

        <div className="p-8 overflow-y-auto flex-1">
          {children}
        </div>

        <div className="p-4 border-t border-zinc-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full bg-zinc-900 text-white py-3.5 rounded-2xl font-medium hover:bg-zinc-800 transition-colors"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  )
}

const HOME_STRATEGY_CONFIG = {
  '1': {
    resultUrl: '/result.json',
    chartUrl: '/chart_data.json',
    gradientId: 'colorReturns',
    tagline: '偏進取與動態選股',
  },
  '2': {
    resultUrl: '/result_2.json',
    chartUrl: '/chart_data_2.json',
    gradientId: 'colorReturns2',
    tagline: '偏穩健與風險控制',
  },
}

export default function HomePage() {
  const [strategyData, setStrategyData] = useState({})
  const [chartByStrategy, setChartByStrategy] = useState({})
  const [selectedPeriodByStrategy, setSelectedPeriodByStrategy] = useState({
    '1': '今年',
    '2': '今年',
  })
  const [infoModalId, setInfoModalId] = useState(null)

  // ==================== 與 RankList 一致的初始 loading 效果 ====================
  const [loadingByStrategy, setLoadingByStrategy] = useState({
    '1': true,
    '2': true,
  })

  useEffect(() => {
    Object.entries(HOME_STRATEGY_CONFIG).forEach(([id, config]) => {
      const loadStrategy = async () => {
        setLoadingByStrategy(prev => ({ ...prev, [id]: true }))

        try {
          const [resultRes, chartRes] = await Promise.all([
            fetch(config.resultUrl, { cache: 'no-store' }),
            fetch(config.chartUrl, { cache: 'no-store' }),
          ])

          const resultJson = resultRes.ok ? await resultRes.json() : null
          const chartJson = chartRes.ok ? await chartRes.json() : null

          if (resultJson) {
            setStrategyData(prev => ({ ...prev, [id]: resultJson }))
          }
          if (chartJson) {
            setChartByStrategy(prev => ({ ...prev, [id]: chartJson }))
          }
        } catch (e) {
          console.error(`Loading strategy ${id} failed:`, e)
        } finally {
          setLoadingByStrategy(prev => ({ ...prev, [id]: false }))
        }
      }

      loadStrategy()
    })
  }, [])

  const primaryData = strategyData['1']

  const renderStrategyCard = entry => {
    const config = HOME_STRATEGY_CONFIG[entry.id]
    if (!config) {
      return (
        <Link
          to={entry.to}
          className="group flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-zinc-900">{entry.name}</div>
              <p className="mt-1.5 text-sm leading-snug text-zinc-600">{entry.tagline}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
            <span>更新：{entry.updateNote}</span>
          </div>
          <div className="mt-5">
            <span className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition group-hover:bg-zinc-800">
              進入策略
            </span>
          </div>
        </Link>
      )
    }

    return (
      <StrategyHomeCard
        entry={entry}
        tagline={config.tagline}
        overview={strategyData[entry.id]?.overview}
        latestDate={strategyData[entry.id]?.latest_date}
        chartData={chartByStrategy[entry.id]}
        selectedPeriod={selectedPeriodByStrategy[entry.id] ?? '今年'}
        onPeriodChange={period =>
          setSelectedPeriodByStrategy(prev => ({ ...prev, [entry.id]: period }))
        }
        onOpenInfo={() => setInfoModalId(entry.id)}
        gradientId={config.gradientId}
        isLoading={loadingByStrategy[entry.id]}
      />
    )
  }

  return (
    <AppSidebarLayout contentClassName="max-w-6xl">
      <div id="top">
        <header className="border-b border-zinc-200/80 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[1.65rem]">
            量化選股策略排名
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-600">
            提供策略入口與最新資訊摘要，讓使用者從首頁直接進入各策略頁面查看排名與分數表現。
          </p>
        </header>

        <section id="strategies" className="mt-3 scroll-mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">策略</h2>
          <p className="mt-1 text-sm text-zinc-600">選擇要查看的策略頁，從首頁作為主要入口進入。</p>

          <ul className="mt-3 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {STRATEGY_ENTRIES.map(entry => (
              <li key={entry.id}>{renderStrategyCard(entry)}</li>
            ))}
          </ul>
        </section>

        {infoModalId === '1' && (
          <StrategyInfoModal
            strategyName="動態多因子"
            onClose={() => setInfoModalId(null)}
          >
            <div className="space-y-5 text-zinc-600 leading-relaxed">
              <p className="text-[15px]">
                本策略為<span className="font-bold text-zinc-900">每季換股</span>的量化多因子模型。
              </p>
              <p className="text-[15px]">
                完全以<span className="font-bold text-zinc-900">固定邏輯規則</span>運作，不含人工主觀挑選，純粹由量化條件與數學模型驅動。
              </p>
              <p className="text-[15px]">
                先透過基本濾網篩選合格股票，再依牛熊市濾網判斷市場狀態，<span className="font-bold text-zinc-900">動態調整因子權重</span>進行排名。
              </p>
              <div className="pt-4">
                <p className="font-medium text-zinc-800 mb-4">因子排名使用：</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-zinc-50 border border-zinc-100 rounded-3xl p-6">
                    <div className="font-semibold text-emerald-700 mb-3">牛市</div>
                    <div className="space-y-2.5 text-[15px]">
                      <div>• RS 相對強弱</div>
                      <div>• PEG 本益成長比</div>
                      <div>• DD 下行風險</div>
                    </div>
                  </div>
                  <div className="bg-zinc-50 border border-zinc-100 rounded-3xl p-6">
                    <div className="font-semibold text-emerald-700 mb-3">熊市</div>
                    <div className="space-y-2.5 text-[15px]">
                      <div>• RS 相對強弱</div>
                      <div>• Corr 低相關性</div>
                      <div>• DD 下行風險</div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-zinc-500 pt-6 border-t">
                點擊「進入策略」查看完整排名、持股明細與詳細選股邏輯
              </p>
            </div>
          </StrategyInfoModal>
        )}

        {infoModalId === '2' && (
          <StrategyInfoModal
            strategyName="高息低波"
            onClose={() => setInfoModalId(null)}
          >
            <div className="space-y-5 text-zinc-600 leading-relaxed">
              <p className="text-[15px]">
                本策略為<span className="font-bold text-zinc-900">每季換股</span>的量化高息低波模型。
              </p>
              <p className="text-[15px]">
                完全以<span className="font-bold text-zinc-900">固定邏輯規則</span>運作，不含人工主觀挑選，純粹由量化條件與數學模型驅動。
              </p>
              <p className="text-[15px]">
                先透過基本濾網篩選合格股票，再透過因子進行排名，同時<span className="font-bold text-zinc-900">限制金融股上限</span>。
              </p>

              <div className="pt-4">
                <p className="font-medium text-zinc-800 mb-4">因子排名使用：</p>
                <div className="bg-zinc-50 border border-zinc-100 rounded-3xl p-6">
                  <div className="space-y-2.5 text-[15px]">
                    <div>• DY 高殖利率</div>
                    <div>• STD 低波動率</div>
                  </div>
                </div>
              </div>

              <p className="text-xs text-zinc-500 pt-6 border-t">
                點擊「進入策略」查看完整排名、持股明細與詳細選股邏輯
              </p>
            </div>
          </StrategyInfoModal>
        )}
        <section id="meta" className="mt-12 scroll-mt-8 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">更新與聯絡</h2>
          <dl className="mt-3 space-y-2 text-sm text-zinc-700">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-zinc-500">最近更新時間</dt>
              <dd>
                {primaryData?.updated_at
                  ? primaryData.updated_at
                  : (primaryData?.latest_date ? `${primaryData.latest_date} 晚上更新` : '—')}
              </dd>
            </div>
          </dl>
        </section>

        <section id="disclaimer" className="mt-8 scroll-mt-8 pb-10">
          <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4">
            <h2 className="text-sm font-semibold text-zinc-900">免責聲明</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              本頁資訊僅供研究與介面展示，不構成任何投資建議。實際決策請自行評估風險並確認資料來源與時效性。
            </p>
          </div>
        </section>
      </div>
    </AppSidebarLayout>
  )
}
