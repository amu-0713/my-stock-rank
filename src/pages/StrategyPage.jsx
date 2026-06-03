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

  // ====================== 牛熊切換狀態（提升到這裡，供 RankList 使用） ======================
  const [regime, setRegime] = useState('bull')

  // ====================== 動態多因子（策略1） ======================
  useEffect(() => {
    if (!isStrategy1) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch('/result.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`\\( {TEXT.loadErrorPrefix} \\)${res.status}`)
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
        if (!res.ok) throw new Error(`\\( {TEXT.loadErrorPrefix} \\)${res.status}`)
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
          {/* 這裡改用 w-full 強制排版 */}
          <div className="mt-1 pl-4 flex flex-wrap flex-col sm:flex-row items-start sm:items-center gap-y-2 sm:gap-x-4 text-xs text-zinc-600 sm:text-sm w-full">
            
            {/* 最新日期 */}
            <div className="flex items-baseline whitespace-nowrap">
              <span className="font-medium">最新日期：</span>
              <span className="ml-1">{data?.latest_date ?? '—'}</span>
            </div>
            
            {/* 分隔線：在 sm 以上顯示 */}
            <div className="hidden sm:block text-zinc-300">｜</div>
            
            {/* 最近換倉日 */}
            <div className="flex items-baseline whitespace-nowrap">
              <span className="font-medium">{TEXT.rebalanceBaseDate}</span>
              <span className="ml-1">{data?.rebalance_base_date ?? '—'}</span>
            </div>
            
            {/* 分隔線：在 sm 以上顯示 */}
            <div className="hidden sm:block text-zinc-300">｜</div>
            
            {/* 預計下次換倉日 (這裡強制獨立一行，如果空間不足) */}
            <div className="flex items-baseline whitespace-nowrap">
              <span className="font-medium text-emerald-700">{TEXT.nextRebalanceDate}</span>
              <span className="ml-1 font-semibold text-emerald-700">{data?.next_rebalance_date ?? '—'}</span>
            </div>
            
          </div>
            </div>

            {/* 手機直式專用牛熊切換按鈕（放在問號的正左側） */}
            {isStrategy1 && (
              <button
                onClick={() => setRegime(prev => (prev === 'bull' ? 'bear' : 'bull'))}
                className="md:hidden landscape:hidden px-8 py-2 rounded-2xl border border-zinc-300 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors shadow-sm flex items-center gap-2"
              >
                {regime === 'bull' ? '牛' : '熊'}
              </button>
            )}

            <Link
              to={`/strategy/${id}/info`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
              title="策略說明"
            >
              ?
            </Link>
          </div>

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
