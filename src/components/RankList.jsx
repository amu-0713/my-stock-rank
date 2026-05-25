// src/components/RankList.jsx
import { useEffect, useMemo, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

const TEXT = {
  totalPrefix: '共 ',
  totalSuffix: ' 筆',
  rank: '排名',
  stock: '股票',
  score: '分數',
  change: '變動',
  empty: '目前沒有資料',
}

function formatMaybeNumber(value) {
  if (value === null || value === undefined) return '--'
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(n)) return n.toLocaleString('zh-TW')
  return String(value)
}

function formatPct(value) {
  if (value === null || value === undefined) return '--'
  const n = typeof value === 'number' ? value : Number(value)
  if (n === 0) return 'N/A'
  if (!Number.isFinite(n)) return '--'
  return `${n.toFixed(1)}%`
}

function formatScore(value) {
  if (value === null || value === undefined) return '--'
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return '--'
  return n.toFixed(1)
}

function formatCompareDate(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return `${match[2]}/${match[3]}`
}

function scoreBadgeClass(value) {
  const n = typeof value === 'number' ? value : Number(value)
  const base = 'inline-flex min-w-[64px] items-center justify-center rounded-full px-2 py-1 text-base font-semibold tabular-nums cursor-pointer hover:underline'
  if (!Number.isFinite(n)) return `${base} bg-gray-200 text-gray-700`
  if (n >= 90) return `${base} bg-red-600 text-white`
  if (n >= 80) return `${base} bg-red-400 text-white`
  if (n >= 70) return `${base} bg-red-100 text-red-700`
  if (n >= 60) return `${base} bg-gray-200 text-gray-700`
  return `${base} bg-gray-100 text-gray-400`
}

function pctBadgeClass(value) {
  const n = typeof value === 'number' ? value : Number(value)
  const base = 'inline-flex min-w-[64px] items-center justify-center rounded-full px-2 py-1 text-sm font-medium tabular-nums'

  if (n === 0) {
    return `${base} bg-sky-200 text-sky-800`
  }

  if (!Number.isFinite(n)) {
    return `${base} bg-gray-200 text-gray-700`
  }

  if (n >= 90) return `${base} bg-green-600 text-white`
  if (n >= 80) return `${base} bg-green-500 text-white`
  if (n >= 70) return `${base} bg-green-300 text-green-900`
  if (n >= 60) return `${base} bg-green-200 text-green-800`

  return `${base} bg-gray-200 text-gray-700`
}

function formatRankChange(changeType, rankChange, prevRank, nextRank) {
  const parsedChange = typeof rankChange === 'number' ? rankChange : Number(rankChange)
  const safeChange = Number.isFinite(parsedChange) ? Math.abs(parsedChange) : null
  const parsedPrevRank = typeof prevRank === 'number' ? prevRank : Number(prevRank)
  const parsedNextRank = typeof nextRank === 'number' ? nextRank : Number(nextRank)
  const rankRange = Number.isFinite(parsedPrevRank) && Number.isFinite(parsedNextRank) ? `（${parsedPrevRank}→${parsedNextRank}）` : null

  switch (changeType) {
    case 'up': return { mainLabel: safeChange === null ? '▲' : `▲ ${safeChange}`, detailLabel: rankRange, className: 'text-emerald-600' }
    case 'down': return { mainLabel: safeChange === null ? '▼' : `▼ ${safeChange}`, detailLabel: rankRange, className: 'text-rose-600' }
    case 'flat': return { mainLabel: '=', detailLabel: '（維持）', className: 'text-zinc-600 text-base font-bold' }
    case 'new': return { mainLabel: 'NEW', detailLabel: null, className: 'text-sky-600' }
    default: return { mainLabel: '--', detailLabel: null, className: 'text-zinc-500' }
  }
}

function getDisplayedRank(row, sortKey, isSearching, currentIndex) {
  if (isSearching) return row.base_rank
  return currentIndex + 1
}

function ScoreModal({ stock, onClose }) {
  if (!stock?.history || stock.history.length === 0) return null
  // ... ScoreModal 完整內容保持不變（請保留你原本的 ScoreModal 程式碼）...
}

const DEFAULT_SORT_KEY = 'score'
const DEFAULT_SORT_DIRECTION = 'desc'
const SORTABLE_FIELD_SET_BY_STRATEGY = {
  '1': new Set(['score', 'rs_pct', 'peg_pct', 'dd_pct', 'rank_change']),
  '2': new Set(['score', 'std_pct', 'dy_pct', 'rank_change']),
}
const METRIC_COLUMNS_BY_STRATEGY = {
  '1': [
    { key: 'rs_pct', label: 'RS', sortable: true, type: 'pct' },
    { key: 'peg_pct', label: 'PEG', sortable: true, type: 'pct' },
    { key: 'dd_pct', label: 'DD', sortable: true, type: 'pct' },
  ],
  '2': [
    { key: 'std_pct', label: 'STD', sortable: true, type: 'pct' },
    { key: 'dy_pct', label: 'DY', sortable: true, type: 'pct' },
    { key: 'industry', label: '產業', sortable: false, type: 'text' },
  ],
}
const STOCK_CELL_LAYOUT_CLASS = 'grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 landscape:max-md:grid-cols-[64px_minmax(0,1fr)] landscape:max-md:gap-2'

export default function RankList({
  title,
  rows,
  defaultSortKey,
  sortableFields,
  compareDate,
  strategyId = '1',
}) {
  const isFilteredRankList = title === '條件篩選排名'
  const showFilterColumn = !isFilteredRankList
  const isMarketRank = title === '市場總排名'   // 判斷是否為全市場

  const sortableFieldSet = useMemo(() => SORTABLE_FIELD_SET_BY_STRATEGY[strategyId] ?? SORTABLE_FIELD_SET_BY_STRATEGY['1'], [strategyId])
  const metricColumns = useMemo(() => METRIC_COLUMNS_BY_STRATEGY[strategyId] ?? METRIC_COLUMNS_BY_STRATEGY['1'], [strategyId])

  const gridCols = showFilterColumn
    ? 'grid-cols-[64px_minmax(150px,220px)_80px_75px_75px_75px_110px_60px]'
    : 'grid-cols-[64px_minmax(150px,220px)_80px_75px_75px_75px_160px]'

  const minWidth = showFilterColumn ? 'min-w-[740px]' : 'min-w-[680px]'

  const formattedCompareDate = formatCompareDate(compareDate)
  const changeHeaderText = formattedCompareDate === null
    ? `${TEXT.change}（vs 上週）`
    : `${TEXT.change}（vs ${formattedCompareDate}）`

  const normalizedDefaultSortKey = useMemo(() => normalizeSortKey(defaultSortKey, sortableFields, sortableFieldSet), [defaultSortKey, sortableFields, sortableFieldSet])

  const [sortKey, setSortKey] = useState(normalizedDefaultSortKey)
  const [sortDirection, setSortDirection] = useState(DEFAULT_SORT_DIRECTION)
  const [selectedStock, setSelectedStock] = useState(null)
  const [search, setSearch] = useState('')

  // ==================== 新增：載入更多 ====================
  const [visibleCount, setVisibleCount] = useState(200)

  const isModalOpen = !!selectedStock

  useEffect(() => {
    setSortKey(normalizedDefaultSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
    if (isMarketRank) setVisibleCount(200)   // 切換到市場總排名時重置為200筆
  }, [normalizedDefaultSortKey, isMarketRank])

  const allowedSortableFields = useMemo(() => {
    if (!Array.isArray(sortableFields) || sortableFields.length === 0) return sortableFieldSet
    return new Set(sortableFields.filter(f => sortableFieldSet.has(f)))
  }, [sortableFields, sortableFieldSet])

  const handleSortChange = useCallback((nextSortKey) => {
    if (!allowedSortableFields.has(nextSortKey)) return
    // ... 原有 handleSortChange 邏輯完全不變 ...
    if (sortKey === nextSortKey) {
      if (isFilteredRankList && nextSortKey === 'rank_change') {
        if (sortDirection === 'desc') setSortDirection('asc')
        else if (sortDirection === 'asc') setSortDirection('new')
        else {
          setSortKey(normalizedDefaultSortKey)
          setSortDirection(DEFAULT_SORT_DIRECTION)
        }
        return
      }
      if (sortDirection === 'desc') {
        setSortDirection('asc')
      } else {
        setSortKey(normalizedDefaultSortKey)
        setSortDirection(DEFAULT_SORT_DIRECTION)
      }
      return
    }
    setSortKey(nextSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
  }, [allowedSortableFields, sortKey, sortDirection, normalizedDefaultSortKey, isFilteredRankList])

  const filteredRows = useMemo(() => {
    const safeRows = Array.isArray(rows) ? rows : []
    const keyword = search.trim().toLowerCase()
    if (!keyword) return safeRows
    return safeRows.filter(row => {
      const stockId = String(row?.stock_id ?? '').toLowerCase()
      const name = String(row?.name ?? '').toLowerCase()
      const fullName = String(row?.full_name ?? '').toLowerCase()
      return stockId.includes(keyword) || name.includes(keyword) || fullName.includes(keyword)
    })
  }, [rows, search])

  const sortedRows = useMemo(() => {
    // ... 原有 sortedRows 邏輯完全不變 ...
    const safeRows = Array.isArray(filteredRows) ? filteredRows : []
    const activeSortKey = normalizeSortKey(sortKey, [...allowedSortableFields], sortableFieldSet)

    if (isFilteredRankList && activeSortKey === 'rank_change' && sortDirection === 'new') {
      return [...safeRows].sort((a, b) => {
        const leftIsNew = a?.change_type === 'new'
        const rightIsNew = b?.change_type === 'new'
        if (leftIsNew !== rightIsNew) return leftIsNew ? -1 : 1
        if (!leftIsNew && !rightIsNew) {
          const rankChangeCompare = compareRows(a, b, 'rank_change', 'desc')
          if (rankChangeCompare !== 0) return rankChangeCompare
        }
        return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) - (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
      })
    }
    return [...safeRows].sort((a, b) => compareRows(a, b, activeSortKey, sortDirection))
  }, [allowedSortableFields, isFilteredRankList, filteredRows, sortDirection, sortKey, sortableFieldSet])

  // ==================== 載入更多處理 ====================
  const displayedRows = useMemo(() => {
    if (!isMarketRank) return sortedRows
    return sortedRows.slice(0, visibleCount)
  }, [sortedRows, visibleCount, isMarketRank])

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + 200, sortedRows.length))
  }

  return (
    <div className={`isolate flex h-full min-h-0 landscape:max-md:h-screen landscape:max-md:min-h-screen flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm max-w-[960px] mx-auto ${isModalOpen ? 'pointer-events-none' : ''}`}>
      {/* 標題區塊保持不變 */}
      <div className="z-40 border-b border-zinc-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 shadow-sm landscape:max-md:pl-5 landscape:max-md:pr-3 landscape:max-md:py-2">
          <div className="text-sm font-semibold text-zinc-900">{title}</div>
          <div className="flex items-center gap-3">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜尋 2330 / 台積電" className="h-8 w-48 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 landscape:max-md:h-7 landscape:max-md:w-40 landscape:max-md:px-2" />
            <div className="text-xs text-zinc-500">共 {sortedRows.length} 筆</div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto -webkit-overflow-scrolling-touch">
        <div className={`${minWidth}`}>
          {/* header 保持不變 */}
          <div className={`sticky top-0 z-10 grid ${gridCols} items-center gap-1 border-b border-zinc-200 bg-white px-4 py-4 text-sm font-semibold text-zinc-600 shadow-sm landscape:max-md:px-3 landscape:max-md:py-1`}>
            {/* ... 原有 header 內容完全不變 ... */}
          </div>

          <div className="divide-y divide-zinc-100">
            {displayedRows.map((row, index) => {
              // ... 原有 row JSX 完全不變 ...
              const rankChange = formatRankChange(row.change_type, row.rank_change, row.prev_rank, row.base_rank)
              const isSearching = !!search.trim()
              const displayedRank = getDisplayedRank(row, sortKey, isSearching, index)

              return (
                <div key={`${row.base_rank ?? index}-${row.stock_id}`} className={`grid ${gridCols} items-center gap-1 px-4 py-4 hover:bg-zinc-50 landscape:max-md:px-3 landscape:max-md:py-2`}>
                  {/* ... 原本的每一格內容完全不變 ... */}
                </div>
              )
            })}

            {sortedRows.length === 0 && (
              <div className="p-8 text-center text-sm text-zinc-500">{TEXT.empty}</div>
            )}
          </div>

          {/* ==================== 載入更多按鈕（只在市場總排名顯示） ==================== */}
          {isMarketRank && displayedRows.length < sortedRows.length && (
            <div className="flex justify-center py-6">
              <button
                onClick={handleLoadMore}
                className="px-6 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-medium rounded-2xl transition-colors flex items-center gap-2"
              >
                載入更多（{displayedRows.length} / {sortedRows.length}）
              </button>
            </div>
          )}
        </div>
      </div>

      {selectedStock && <ScoreModal stock={selectedStock} onClose={() => setSelectedStock(null)} />}
    </div>
  )
}
