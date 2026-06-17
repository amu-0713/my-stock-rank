// src/pages/StrategyPage.jsx
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import Tabs from '../components/Tabs.jsx'
import RankList from '../components/RankList.jsx'

const TEXT = {
  loadErrorPrefix: '讀取資料失敗：HTTP ',
  loadError: '讀取資料失敗',
  currentHoldingsRank: '目前持股排名',
  filteredRank: '條件篩選排名',
  marketRank: '市場總排名',
  strategyDataPage: '策略資料頁面',
  latestDate: '最新日期：',
  rebalanceBaseDate: '最近換倉日：',
  nextRebalanceDate: '預計下次換倉日：',
  strategyInfo: '策略說明',
  loading: '資料載入中...',
  verifyJsonPrefix: '請確認 ',
  verifyJsonSuffix: ' 已存在且格式正確。',
}

const STRATEGY_TITLES = {
  '1': '動態多因子策略',
  '2': '高息低波策略',
}

export default function StrategyPage() {
  const { id } = useParams()
  const isStrategy1 = id === '1'
  const isStrategy2 = id === '2'

  const [activeTab, setActiveTab] = useState('current_holdings_rank')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // ====================== 牛熊切換狀態 ======================
  const [regime, setRegime] = useState('bull')

  // ====================== 動態多因子（策略1） ======================
  useEffect(() => {
    if (!isStrategy1) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/result.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${TEXT.loadErrorPrefix}${res.status}`)
        return await res.json()
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : TEXT.loadError)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [isStrategy1])

  // ====================== 高息低波（策略2） ======================
  useEffect(() => {
    if (!isStrategy2) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/result_2.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`${TEXT.loadErrorPrefix}${res.status}`)
        return await res.json()
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : TEXT.loadError)
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [isStrategy2])

  const tabItems = useMemo(() => [
    { id: 'current_holdings_rank', label: TEXT.currentHoldingsRank },
    { id: 'filtered_rank', label: TEXT.filteredRank },
    { id: 'market_rank', label: TEXT.marketRank },
  ], [])

  const title = STRATEGY_TITLES[id] ?? `策略${id}`

  return (
    <AppSidebarLayout contentClassName="max-w-[960px] mx-auto" flushTopOnLandscape>
      <div className="flex h-[calc(100vh-5rem)] min-h-0 flex-col sm:h-[calc(100vh-5rem)] max-w-[960px] mx-auto overflow-hidden landscape:max-md:fixed landscape:max-md:inset-0 landscape:max-md:h-dvh landscape:max-md:max-w-none landscape:max-md:mx-0 landscape:max-md:w-[calc(100%+2rem)] landscape:max-md:-mx-4 landscape:max-md:overflow-hidden landscape:max-md:pl-10">

        {/* Header */}
        <div className="sticky top-0 z-50 space-y-4 border-b border-zinc-200 bg-zinc-50 pb-4 shadow-sm sm:space-y-6 sm:pb-6 landscape:max-md:space-y-0 landscape:max-md:pb-0 landscape:max-md:pt-0">
          <div className="flex items-start justify-between gap-3 landscape:max-md:hidden">
            {/* 左側：標題 + 日期資訊 */}
            <div className="flex-1 min-w-0">
              <div className="pl-4 text-lg font-semibold sm:text-xl">{title}</div>

              <div className="mt-1 pl-4 flex flex-wrap sm:flex-row sm:items-center gap-y-1 sm:gap-x-4 text-xs text-zinc-600 sm:text-sm">
                {/* 最新日期 */}
                <div className="flex items-baseline">
                  <span className="font-medium">最新日期：</span>
                  <span className="ml-1">{data?.latest_date ?? '—'}</span>
                </div>

                <div className="hidden sm:block text-zinc-300">｜</div>

                {/* 最近換倉日 */}
                <div className="flex items-baseline">
                  <span className="font-medium">{TEXT.rebalanceBaseDate}</span>
                  <span className="ml-1">{data?.rebalance_base_date ?? '—'}</span>
                </div>

                <div className="hidden sm:block text-zinc-300">｜</div>

                {/* 預計下次換倉日 */}
                <div className="flex items-baseline">
                  <span className="font-medium text-emerald-700">{TEXT.nextRebalanceDate}</span>
                  <span className="ml-1 font-semibold text-emerald-700">{data?.next_rebalance_date ?? '—'}</span>
                </div>
              </div>
            </div>

            {/* 右側按鈕群組 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* 桌面版牛熊切換按鈕 */}
              {isStrategy1 && (
                <button
                  onClick={() => setRegime(prev => (prev === 'bull' ? 'bear' : 'bull'))}
                  disabled={loading}
                  className={`hidden md:flex items-center gap-2 px-5 py-2 rounded-2xl border transition-all shadow-sm disabled:opacity-50
                    ${regime === 'bull' 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' 
                      : 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                    }`}
                >
                  {regime === 'bull' ? (
                    <>
                      <span className="text-lg">📈</span>
                      <span className="font-medium">牛市模式</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg">📉</span>
                      <span className="font-medium">熊市模式</span>
                    </>
                  )}
                </button>
              )}

              {/* 手機直式牛熊切換按鈕 */}
              {isStrategy1 && (
                <button
                  onClick={() => setRegime(prev => (prev === 'bull' ? 'bear' : 'bull'))}
                  className={`md:hidden landscape:hidden flex items-center gap-1.5 px-4 py-1.5 rounded-2xl border text-sm font-medium transition-all shadow-sm
                    ${regime === 'bull' 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                    }`}
                >
                  {regime === 'bull' ? '📈 牛' : '📉 熊'}
                </button>
              )}

              {/* 策略說明按鈕 */}
              <Link
                to={`/strategy/${id}/info`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
                title="策略說明"
              >
                ?
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="landscape:max-md:pr-6 landscape:max-md:scale-[0.9] landscape:max-md:origin-top-left landscape:max-md:w-[111.111%]">
            <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />
          </div>
        </div>

        {/* 內容區塊 */}
        <div className="min-h-0 flex-1 bg-zinc-50 overflow-hidden landscape:max-md:overflow-hidden">
          {loading ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
              資料載入中...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="h-full min-h-0 landscape:max-md:h-full">
              <div className="h-full min-h-0 landscape:max-md:pr-6 landscape:max-md:scale-[0.9] landscape:max-md:origin-top-left landscape:max-md:w-[111.111%]">
                <RankList
                  key={activeTab}
                  title={tabItems.find((tab) => tab.id === activeTab)?.label}
                  rows={data?.[activeTab] ?? []}
                  defaultSortKey={data?.default_sort_key}
                  sortableFields={data?.sortable_fields}
                  compareDate={data?.compare_date}
                  strategyId={id}
                  regime={regime}
                  setRegime={setRegime}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppSidebarLayout>
  )
}
