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
  rebalanceBaseDate: '調倉基準日：',
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
      {/* 1. 最外層容器：
        全面鎖定高度為 `h-[calc(100dvh-4rem)]`，無論直式橫式或電腦，
        都強制讓整頁的高度死死卡在可視螢幕內，並用 overflow-hidden 徹底阻斷整頁 scroll。
      */}
      <div className="flex w-full h-[calc(100dvh-4rem)] sm:h-[calc(100vh-5rem)] min-h-0 flex-col max-w-[960px] mx-auto overflow-hidden landscape:max-md:fixed landscape:max-md:inset-0 landscape:max-md:h-dvh landscape:max-md:max-w-none landscape:max-md:mx-0 landscape:max-md:w-[calc(100%+2rem)] landscape:max-md:-mx-4 landscape:max-md:pl-10">

        {/* 2. Header 區塊：
          加上 flex-shrink-0，確保上方的標題與頁籤在直式小螢幕下絕對不會被壓縮變形。
        */}
        <div className="flex-shrink-0 sticky top-0 z-50 space-y-4 border-b border-zinc-200 bg-zinc-50 pb-4 shadow-sm sm:space-y-6 sm:pb-6 landscape:max-md:space-y-0 landscape:max-md:pb-0 landscape:max-md:pt-0">
          <div className="flex items-start justify-between gap-3 landscape:max-md:hidden">
            <div>
              <div className="pl-4 text-lg font-semibold sm:text-xl">{title}</div>
              <div className="mt-1 pl-4 flex flex-col sm:flex-row sm:items-center gap-y-1 sm:gap-x-4 text-xs text-zinc-600 sm:text-sm">
                <div className="flex items-baseline">
                  <span className="font-medium">最新日期：</span>
                  <span className="ml-1">{data?.latest_date ?? '—'}</span>
                </div>
                <div className="hidden sm:block text-zinc-300">｜</div>
                <div className="flex items-baseline">
                  <span className="font-medium">調倉基準日：</span>
                  <span className="ml-1">{data?.rebalance_base_date ?? '—'}</span>
                </div>
              </div>
            </div>
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

        {/* 3. 下方內容與表格區塊：
          使用 `flex-1 min-h-0`。這步是讓直式不破版的終極核心！
          它會強迫這個區塊自動吃滿扣除 Header 後的「剩餘精確高度」。
          當高度被固定住後，RankList 內部的滾動機制就會被完美激活，少掉的三檔股票就能流暢滑到了！
        */}
        <div className="flex-1 min-h-0 bg-zinc-50 overflow-hidden">
          {loading ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
              資料載入中...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="h-full min-h-0">
              <div className="h-full min-h-0 landscape:max-md:pr-6 landscape:max-md:scale-[0.9] landscape:max-md:origin-top-left landscape:max-md:w-[111.111%]">
                <RankList
                  title={tabItems.find((tab) => tab.id === activeTab)?.label}
                  rows={data?.[activeTab] ?? []}
                  defaultSortKey={data?.default_sort_key}
                  sortableFields={data?.sortable_fields}
                  compareDate={data?.compare_date}
                  strategyId={id}
                />
              </div>
            </div>
          )}
        </div>

      </div>
    </AppSidebarLayout>
  )
}
