// src/components/RankList.jsx
import { useEffect, useMemo, useState } from 'react'
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
  
  // === 新增：PEG=0 顯示「缺失」 ===
  if (n === 0) {
    return 'N/A'
  }
  
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

  // PEG = 0 特別處理（之後會改成「缺值」文字）
  if (n === 0) {
    return `${base} bg-sky-200 text-sky-800`
  }

  if (!Number.isFinite(n)) {
    return `${base} bg-gray-200 text-gray-700`
  }

  // 10分區間漸層（簡潔版）
  if (n >= 90) return `${base} bg-green-600 text-white`     // 90以上：深綠（最強）
  if (n >= 80) return `${base} bg-green-500 text-white`     // 80～89：綠
  if (n >= 70) return `${base} bg-green-300 text-green-900` // 70～79：淺綠
  if (n >= 60) return `${base} bg-green-200 text-green-800` // 60～69：淡黃 / 黃綠

  // 60以下（包含正常低分）→ 灰色
  return `${base} bg-gray-200 text-gray-700`
}
function formatRankChange(changeType, rankChange, prevRank, nextRank) {
  const parsedChange = typeof rankChange === 'number' ? rankChange : Number(rankChange)
  const safeChange = Number.isFinite(parsedChange) ? Math.abs(parsedChange) : null
  const parsedPrevRank = typeof prevRank === 'number' ? prevRank : Number(prevRank)
  const parsedNextRank = typeof nextRank === 'number' ? nextRank : Number(nextRank)
  const rankRange =
    Number.isFinite(parsedPrevRank) && Number.isFinite(parsedNextRank)
      ? `（${parsedPrevRank}→${parsedNextRank}）`
      : null

  switch (changeType) {
    case 'up':
      return { mainLabel: safeChange === null ? '▲' : `▲ ${safeChange}`, detailLabel: rankRange, className: 'text-emerald-600' }
    case 'down':
      return { mainLabel: safeChange === null ? '▼' : `▼ ${safeChange}`, detailLabel: rankRange, className: 'text-rose-600' }
    case 'flat':
      return { mainLabel: '=', detailLabel: '（維持）', className: 'text-zinc-600 text-base font-bold' }
    case 'new':
      return { mainLabel: 'NEW', detailLabel: null, className: 'text-sky-600' }
    default:
      return { mainLabel: '--', detailLabel: null, className: 'text-zinc-500' }
  }
}

function getDisplayedRank(row, sortKey, isSearching, currentIndex) {
  if (isSearching) {
    return row.base_rank
  }
  return currentIndex + 1
}

function ScoreModal({ stock, onClose }) {
  if (!stock?.history || stock.history.length === 0) return null

  const scoreValues = stock.history.map(item => item.score || 50)
  const minData = Math.min(...scoreValues)
  const maxData = Math.max(...scoreValues)
  const minScore = minData - 1
  const maxScore = maxData + 1.5
  const range = maxScore - minScore
  const vWidth = 500
  const vHeight = 260
  const pointsData = stock.history.map((item, i) => {
    const x = (i / (stock.history.length - 1)) * vWidth
    const clampedScore = Math.max(minScore, Math.min(maxScore, item.score))
    const y = vHeight - ((clampedScore - minScore) / range) * vHeight
    return { x, y, date: item.date, score: item.score }
  })
  const polylinePoints = pointsData.map(p => `${p.x},${p.y}`).join(' ')

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative bg-white rounded-3xl w-full max-w-lg landscape:max-md:max-w-[540px] landscape:max-md:flex shadow-2xl overflow-hidden pointer-events-auto mx-4" onClick={e => e.stopPropagation()}>
        
        {/* 橫式右上角關閉按鈕 */}
        <button 
          onClick={onClose} 
          className="hidden landscape:max-md:block absolute top-3 right-3 z-50 p-2 text-gray-400 hover:text-zinc-900 bg-white/80 backdrop-blur-sm rounded-full transition-colors"
        >
          ✕
        </button>

        {/* 左邊區塊（手機橫式） */}
        <div className="hidden landscape:max-md:flex landscape:max-md:flex-col landscape:max-md:w-[38%] p-6 landscape:max-md:p-4 border-r">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-bold text-2xl landscape:max-md:text-lg text-zinc-900 leading-tight landscape:max-md:pr-4">
                {stock.name} ({stock.stock_id})
              </div>
              <div className="text-4xl landscape:max-md:text-2xl font-bold text-blue-600 mt-2 landscape:max-md:mt-1">
                {formatScore(stock.display_score)}
              </div>
            </div>
          </div>

          {stock.passed_filter ? (
            <div className="mt-auto rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
              已通過選股條件
            </div>
          ) : (
            stock.failed_conditions && stock.failed_conditions.length > 0 && (
              <div className="mt-auto rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                <div className="font-bold mb-0.5">未通過原因</div>
                <div className="leading-relaxed">
                  {stock.failed_conditions.join('、')}
                </div>
              </div>
            )
          )}
        </div>

        {/* 右邊區塊（走勢圖與直式通用內容） */}
        <div className="w-full landscape:max-md:w-[62%]">
          
          {/* 標題區（直式顯示，橫式隱藏） */}
          <div className="p-6 border-b landscape:max-md:hidden">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-2xl text-zinc-900">
                  {stock.name} ({stock.stock_id})
                </div>
                <div className="text-4xl font-bold text-blue-600 mt-2">
                  {formatScore(stock.display_score)}
                </div>
              </div>
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-zinc-900 transition-colors">
                ✕
              </button>
            </div>
          </div>

          {/* 主要內容區：圖表走勢 */}
          <div className="p-6 landscape:max-md:p-4">
            <div className="text-sm font-bold text-zinc-500 mb-6 landscape:max-md:mb-2 uppercase tracking-wider landscape:max-md:text-xs">
              最近 5 個交易日分數走勢
            </div>

            <div className="relative h-[280px] landscape:max-md:h-[180px] w-full border border-zinc-100 rounded-2xl bg-zinc-50/50 p-4 landscape:max-md:p-2">
              <svg viewBox={`0 0 ${vWidth} ${vHeight}`} className="w-full h-full overflow-visible">
                {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
                  const y = vHeight * p
                  return (
                    <line
                      key={i}
                      x1="0"
                      y1={y}
                      x2={vWidth}
                      y2={y}
                      stroke="#e2e8f0"
                      strokeWidth="1"
                      strokeDasharray="4 4"
                    />
                  )
                })}

                <polyline
                  points={polylinePoints}
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="4"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />

                {pointsData.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="7" fill="#8b5cf6" stroke="#ffffff" strokeWidth="3" />
                    <text
                      x={p.x}
                      y={p.y - 18}
                      textAnchor="middle"
                      className="text-[18px] font-black tabular-nums"
                      style={{
                        fill: '#4b5563',
                        paintOrder: 'stroke',
                        stroke: '#ffffff',
                        strokeWidth: '4px',
                        strokeLinejoin: 'round',
                      }}
                    >
                      {p.score.toFixed(1)}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <div className="flex justify-between mt-4 landscape:max-md:mt-2 text-sm landscape:max-md:text-xs text-zinc-500 font-bold px-2">
              {stock.history.map((item, i) => (
                <div key={i}>{item.date.slice(5)}</div>
              ))}
            </div>

            {/* 未通過原因（直式顯示，橫式隱藏） */}
            <div className="landscape:max-md:hidden">
              {stock.passed_filter ? (
                <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-600">
                  已通過選股條件
                </div>
              ) : (
                stock.failed_conditions && stock.failed_conditions.length > 0 && (
                  <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    <div className="font-bold mb-1">未通過原因</div>
                    <div>{stock.failed_conditions.join('、')}</div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
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

function getSortableFieldSet(strategyId) {
  return SORTABLE_FIELD_SET_BY_STRATEGY[strategyId] ?? SORTABLE_FIELD_SET_BY_STRATEGY['1']
}

function getMetricColumns(strategyId) {
  return METRIC_COLUMNS_BY_STRATEGY[strategyId] ?? METRIC_COLUMNS_BY_STRATEGY['1']
}

function normalizeSortKey(sortKey, sortableFields, sortableFieldSet) {
  if (
    typeof sortKey === 'string' &&
    sortableFieldSet.has(sortKey) &&
    (!Array.isArray(sortableFields) || sortableFields.includes(sortKey))
  ) {
    return sortKey
  }
  return DEFAULT_SORT_KEY
}

function parseSortValue(value) {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function compareRows(a, b, sortKey, sortDirection) {
  const left = parseSortValue(a?.[sortKey])
  const right = parseSortValue(b?.[sortKey])

  if (left === null && right === null) {
    return (
      (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
      (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
    )
  }

  if (left === null) return 1
  if (right === null) return -1

  if (left !== right) {
    return sortDirection === 'asc' ? left - right : right - left
  }

  return (
    (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
    (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
  )
}

function headerClassName(isClickable, isActive) {
  const base = 'flex min-h-[52px] landscape:max-md:min-h-[40px] h-full flex-col items-center justify-center bg-transparent px-1 landscape:max-md:py-0.5 py-1 text-center leading-tight transition-colors'
  if (!isClickable) return base
  return `${base} cursor-pointer select-none ${isActive ? 'text-zinc-900' : 'hover:text-zinc-900'}`
}

function sortIndicator(sortDirection, isActive) {
  if (!isActive) return '< >'
  if (sortDirection === 'new') return 'NEW'
  return sortDirection === 'asc' ? '^' : 'v'
}

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

  const sortableFieldSet = useMemo(() => getSortableFieldSet(strategyId), [strategyId])
  const metricColumns = useMemo(() => getMetricColumns(strategyId), [strategyId])

  const gridCols = showFilterColumn
    ? 'grid-cols-[64px_minmax(150px,220px)_80px_75px_75px_75px_110px_60px]'
    : 'grid-cols-[64px_minmax(150px,220px)_80px_75px_75px_75px_160px]'

  const minWidth = showFilterColumn ? 'min-w-[740px]' : 'min-w-[680px]'

  const formattedCompareDate = formatCompareDate(compareDate)
  const changeHeaderText =
    formattedCompareDate === null
      ? `${TEXT.change}（vs 上週）`
      : `${TEXT.change}（vs ${formattedCompareDate}）`

  const normalizedDefaultSortKey = useMemo(
    () => normalizeSortKey(defaultSortKey, sortableFields, sortableFieldSet),
    [defaultSortKey, sortableFields, sortableFieldSet]
  )

  const [sortKey, setSortKey] = useState(normalizedDefaultSortKey)
  const [sortDirection, setSortDirection] = useState(DEFAULT_SORT_DIRECTION)
  const [selectedStock, setSelectedStock] = useState(null)
  const [search, setSearch] = useState('')

  const isModalOpen = !!selectedStock

  useEffect(() => {
    setSortKey(normalizedDefaultSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
  }, [normalizedDefaultSortKey])

  const allowedSortableFields = useMemo(() => {
    if (!Array.isArray(sortableFields) || sortableFields.length === 0) return sortableFieldSet
    return new Set(sortableFields.filter(f => sortableFieldSet.has(f)))
  }, [sortableFields, sortableFieldSet])

  const filteredRows = useMemo(() => {
    const safeRows = Array.isArray(rows) ? rows : []
    const keyword = search.trim().toLowerCase()

    if (!keyword) return safeRows

    return safeRows.filter(row => {
      const stockId = String(row?.stock_id ?? '').toLowerCase()
      const name = String(row?.name ?? '').toLowerCase()
      const fullName = String(row?.full_name ?? '').toLowerCase()

      return (
        stockId.includes(keyword) ||
        name.includes(keyword) ||
        fullName.includes(keyword)
      )
    })
  }, [rows, search])

  const sortedRows = useMemo(() => {
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

        return (
          (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
          (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
        )
      })
    }

    return [...safeRows].sort((a, b) => compareRows(a, b, activeSortKey, sortDirection))
  }, [allowedSortableFields, isFilteredRankList, filteredRows, sortDirection, sortKey, sortableFieldSet])

  const handleSortChange = nextSortKey => {
    if (!allowedSortableFields.has(nextSortKey)) return

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
  }

  return (
    /* 【邏輯自洽的高度配置核心】
      - 預設（直式/電腦）：h-full min-h-0，完美承接父層 flex-1 所規範的剩餘螢幕高度，不蠻幹超出。
      - 手機橫式（landscape:max-md:）：h-screen min-h-screen，配合 fixed 全螢幕展開，提供滿版滾動計算基準。
    */
    <div className={`isolate flex h-full min-h-0 landscape:max-md:h-screen landscape:max-md:min-h-screen flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm max-w-[960px] mx-auto ${isModalOpen ? 'pointer-events-none' : ''}`}>
      <div className="z-40 border-b border-zinc-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 shadow-sm landscape:max-md:pl-5 landscape:max-md:pr-3 landscape:max-md:py-2">
          <div className="text-sm font-semibold text-zinc-900">{title}</div>

          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋 2330 / 台積電"
              className="h-8 w-48 rounded-lg border border-zinc-200 px-3 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 landscape:max-md:h-7 landscape:max-md:w-40 landscape:max-md:px-2"
            />

            <div className="text-xs text-zinc-500">
              共 {sortedRows.length} 筆
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto -webkit-overflow-scrolling-touch">
        <div className={`${minWidth}`}>
          <div className={`sticky top-0 z-10 grid ${gridCols} items-center gap-1 border-b border-zinc-200 bg-white px-4 py-4 text-sm font-semibold text-zinc-600 shadow-sm landscape:max-md:px-3 landscape:max-md:py-1`}>
            <div className="flex min-h-[52px] items-center justify-center text-center landscape:max-md:min-h-[40px]">{TEXT.rank}</div>

            <div className={`${STOCK_CELL_LAYOUT_CLASS} min-h-[52px] text-left landscape:max-md:min-h-[40px]`}>
              <div className="col-span-2 self-center justify-self-start text-left">{TEXT.stock}</div>
            </div>

            <button
              type="button"
              className={headerClassName(allowedSortableFields.has('score'), sortKey === 'score')}
              onClick={() => handleSortChange('score')}
            >
              <span>{TEXT.score}</span>
              <span className="text-xs">{sortIndicator(sortDirection, sortKey === 'score')}</span>
            </button>

            {metricColumns.map(column => {
              if (!column.sortable) {
                return (
                  <div
                    key={column.key}
                    className="flex min-h-[52px] items-center justify-center text-center landscape:max-md:min-h-[40px]"
                  >
                    {column.label}
                  </div>
                )
              }

              return (
                <button
                  key={column.key}
                  type="button"
                  className={headerClassName(allowedSortableFields.has(column.key), sortKey === column.key)}
                  onClick={() => handleSortChange(column.key)}
                >
                  <span>{column.label}</span>
                  <span className="text-xs">{sortIndicator(sortDirection, sortKey === column.key)}</span>
                </button>
              )
            })}

            <button
              type="button"
              className={`${headerClassName(allowedSortableFields.has('rank_change'), sortKey === 'rank_change')} flex items-center justify-center min-h-[52px]`}
              onClick={() => handleSortChange('rank_change')}
            >
              <span className="whitespace-nowrap text-center">{changeHeaderText}</span>
              <span className="ml-1 text-xs">{sortIndicator(sortDirection, sortKey === 'rank_change')}</span>
            </button>

            {showFilterColumn && (
              <div className="flex min-h-[52px] items-center justify-center text-center">
                濾網
              </div>
            )}
          </div>

          <div className="divide-y divide-zinc-100">
            {sortedRows.map((row, index) => {
              const rankChange = formatRankChange(row.change_type, row.rank_change, row.prev_rank, row.base_rank)
              const isSearching = !!search.trim()
              const displayedRank = getDisplayedRank(row, sortKey, isSearching, index)

              return (
                <div
                  key={`${row.base_rank ?? index}-${row.stock_id}`}
                  className={`grid ${gridCols} items-center gap-1 px-4 py-4 hover:bg-zinc-50 landscape:max-md:px-3 landscape:max-md:py-2`}
                >
                  <div className="text-center text-sm font-semibold tabular-nums">
                    {formatMaybeNumber(displayedRank)}
                  </div>

                  <div className={`${STOCK_CELL_LAYOUT_CLASS} text-left text-sm tabular-nums`}>
                    <span className="font-bold text-zinc-900">{row.stock_id ?? '--'}</span>
                    <span className="min-w-0 truncate font-normal" title={row.full_name ?? ''}>
                      {row.name ?? '--'}
                    </span>
                  </div>

                  <div className="text-center text-sm tabular-nums" onClick={() => setSelectedStock(row)}>
                    <span className={scoreBadgeClass(row.display_score)}>
                      {formatScore(row.display_score)}
                    </span>
                  </div>

                  {metricColumns.map(column => (
                    <div key={column.key} className="text-center text-sm tabular-nums">
                      {column.type === 'pct' ? (
                        <span className={`${pctBadgeClass(row[column.key])} opacity-80`}>
                          {formatPct(row[column.key])}
                        </span>
                      ) : (
                        <span
                          className="inline-block max-w-full truncate text-zinc-700"
                          title={row[column.key] ?? ''}
                        >
                          {row[column.key] ?? '--'}
                        </span>
                      )}
                    </div>
                  ))}

                  <div className={`flex flex-col items-center justify-center text-sm font-semibold tabular-nums ${rankChange.className} min-h-[52px] landscape:max-md:min-h-[40px]`}>
                    <div>{rankChange.mainLabel}</div>
                    {rankChange.detailLabel && (
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {rankChange.detailLabel}
                      </div>
                    )}
                  </div>

                  {showFilterColumn && (
                    <button
                      type="button"
                      className="flex min-h-[52px] items-center justify-center rounded-xl hover:bg-zinc-100 landscape:max-md:min-h-[40px]"
                      onClick={() => setSelectedStock(row)}
                      title={row.passed_filter ? '通過濾網' : '未通過濾網，點擊查看原因'}
                    >
                      {row.passed_filter ? (
                        <span className="text-xl font-black text-emerald-600">✔</span>
                      ) : (
                        <span className="text-xl font-black text-rose-500">✖</span>
                      )}
                    </button>
                  )}
                </div>
              )
            })}

            {sortedRows.length === 0 && (
              <div className="p-8 text-center text-sm text-zinc-500">
                {TEXT.empty}
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedStock && (
        <ScoreModal stock={selectedStock} onClose={() => setSelectedStock(null)} />
      )}
    </div>
  )
}
