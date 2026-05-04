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

    return () => {
      cancelled = true
    }
  }, [isStrategy1])

  const tabItems = useMemo(
    () => [
      { id: 'current_holdings_rank', label: TEXT.currentHoldingsRank },
      { id: 'filtered_rank', label: TEXT.filteredRank },
      { id: 'market_rank', label: TEXT.marketRank },
    ],
    [],
  )

  const strategyHeaderText = useMemo(() => {
    if (!isStrategy1) return TEXT.strategyDataPage
  
    const parts = [
      `${TEXT.latestDate}${data?.latest_date ?? '—'}`,
      `${TEXT.rebalanceBaseDate}${data?.rebalance_base_date ?? '—'}`,
    ]
  
    return parts.join(' | ')
  }, [data, isStrategy1])

  const title = STRATEGY_TITLES[id] ?? `策略${id}`

  return (
    <AppSidebarLayout contentClassName="max-w-[960px] mx-auto">
      <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col sm:h-[calc(100vh-5rem)] max-w-[960px] mx-auto">
        <div className="sticky top-0 z-50 space-y-4 border-b border-zinc-200 bg-zinc-50 pb-4 shadow-sm sm:space-y-6 sm:pb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="pl-4 text-lg font-semibold sm:text-xl">{title}</div>
              <div className="mt-1 pl-4 text-xs text-zinc-600 sm:text-sm">{strategyHeaderText}</div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                to={`/strategy/${id}/info`}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
                aria-label={TEXT.strategyInfo}
                title={TEXT.strategyInfo}
              >
                ?
              </Link>
            </div>
          </div>

          {isStrategy1 ? <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} /> : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50">
          {isStrategy1 ? (
            loading ? (
              <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
                {TEXT.loading}
              </div>
            ) : error ? (
              <div className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
                {error}
                <div className="mt-2 text-xs text-zinc-600">
                  {TEXT.verifyJsonPrefix}
                  <code>public/result.json</code>
                  {TEXT.verifyJsonSuffix}
                </div>
              </div>
            ) : (
              <RankList
                title={tabItems.find((tab) => tab.id === activeTab)?.label}
                rows={data?.[activeTab] ?? []}
                defaultSortKey={data?.default_sort_key}
                sortableFields={data?.sortable_fields}
                compareDate={data?.compare_date}
              />
            )
          ) : isStrategy2 ? (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
              {title}（尚未開放）
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
              {title}
            </div>
          )}
        </div>
      </div>
    </AppSidebarLayout>
  )
}
