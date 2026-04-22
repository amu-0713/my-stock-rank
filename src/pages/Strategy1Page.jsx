import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Tabs from '../components/Tabs.jsx'
import RankList from '../components/RankList.jsx'

export default function Strategy1Page() {
  const [activeTab, setActiveTab] = useState('current_holdings_rank')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/result.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`讀取失敗（HTTP ${res.status}）`)
        return await res.json()
      })
      .then((json) => {
        if (cancelled) return
        setData(json)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : '讀取失敗')
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const tabItems = useMemo(
    () => [
      { id: 'current_holdings_rank', label: '當前持股排名' },
      { id: 'filtered_rank', label: '濾網通過排名' },
      { id: 'market_rank', label: '全市場排名' },
    ],
    [],
  )

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold sm:text-xl">策略1</div>
          <div className="mt-1 text-xs text-zinc-600 sm:text-sm">
            最新日期：{data?.latest_date ?? '—'}　|　調倉基準日：
            {data?.rebalance_base_date ?? '—'}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            to="/strategy/1/info"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
            aria-label="策略說明"
            title="策略說明"
          >
            ⓘ
          </Link>
          <Link
            to="/strategies"
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
          >
            返回策略選擇
          </Link>
        </div>
      </div>

      <Tabs items={tabItems} activeId={activeTab} onChange={setActiveTab} />

      {loading ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm text-zinc-600">
          讀取中…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-white p-5 text-sm text-red-700">
          {error}
          <div className="mt-2 text-xs text-zinc-600">
            請確認 `public/result.json` 已存在且可被讀取。
          </div>
        </div>
      ) : (
        <RankList
          title={tabItems.find((t) => t.id === activeTab)?.label}
          rows={data?.[activeTab] ?? []}
          compareDate={data?.compare_date}
          showPassedFilter={activeTab === 'current_holdings_rank'}
        />
      )}
    </div>
  )
}

