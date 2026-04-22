import { useEffect, useMemo, useState } from 'react'

const TEXT = {
  totalPrefix: '\u5171\u0020',
  totalSuffix: '\u0020\u7b46',
  rank: '\u6392\u540d',
  stock: '\u80a1\u7968',
  score: '\u5206\u6578',
  change: '\u8b8a\u52d5',
  empty: '\u76ee\u524d\u6c92\u6709\u8cc7\u6599',
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
  const base = 'inline-flex min-w-[64px] items-center justify-center rounded-full px-2 py-1 text-base font-semibold tabular-nums'
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
  if (!Number.isFinite(n)) return `${base} bg-gray-200 text-gray-700`
  if (n >= 90) return `${base} bg-green-600 text-white`
  if (n >= 85) return `${base} bg-green-400 text-white`
  if (n >= 70) return `${base} bg-green-200 text-green-800`
  return `${base} bg-gray-200 text-gray-700`
}

function formatRankChange(changeType, rankChange, prevRank, nextRank) {
  const parsedChange = typeof rankChange === 'number' ? rankChange : Number(rankChange)
  const safeChange = Number.isFinite(parsedChange) ? Math.abs(parsedChange) : null
  const parsedPrevRank = typeof prevRank === 'number' ? prevRank : Number(prevRank)
  const parsedNextRank = typeof nextRank === 'number' ? nextRank : Number(nextRank)
  const rankRange = Number.isFinite(parsedPrevRank) && Number.isFinite(parsedNextRank)
    ? `（${parsedPrevRank}\u2192${parsedNextRank}）`
    : null

  switch (changeType) {
    case 'up':
      return {
        mainLabel: safeChange === null ? '\u25B2' : `\u25B2 ${safeChange}`,
        detailLabel: rankRange,
        className: 'text-emerald-600',
      }
    case 'down':
      return {
        mainLabel: safeChange === null ? '\u25BC' : `\u25BC ${safeChange}`,
        detailLabel: rankRange,
        className: 'text-rose-600',
      }
    case 'flat':
      return {
        mainLabel: '=',
        detailLabel: '（維持）',
        className: 'text-zinc-600 text-base font-bold',
      }
    case 'new':
      return {
        mainLabel: 'NEW',
        detailLabel: null,
        className: 'text-sky-600',
      }
    default:
      return {
        mainLabel: safeChange === null ? '--' : String(safeChange),
        detailLabel: null,
        className: 'text-zinc-500',
      }
  }
}

const DEFAULT_SORT_KEY = 'score'
const DEFAULT_SORT_DIRECTION = 'desc'
const SORTABLE_FIELD_SET = new Set(['score', 'rs_pct', 'peg_pct', 'dd_pct', 'rank_change'])
const STOCK_CELL_LAYOUT_CLASS = 'grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3'

function normalizeSortKey(sortKey, sortableFields) {
  if (typeof sortKey === 'string' && SORTABLE_FIELD_SET.has(sortKey) &&
      (!Array.isArray(sortableFields) || sortableFields.includes(sortKey))) {
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
    return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
           (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
  }

  if (left === null) return 1
  if (right === null) return -1

  if (left !== right) {
    return sortDirection === 'asc' ? left - right : right - left
  }

  return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
         (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
}

function headerClassName(isClickable, isActive) {
  const base = 'flex min-h-[52px] h-full flex-col items-center justify-center bg-transparent px-1 py-1 text-center leading-tight transition-colors'
  if (!isClickable) return base
  return `${base} cursor-pointer select-none ${isActive ? 'text-zinc-900' : 'hover:text-zinc-900'}`
}

function sortIndicator(sortDirection, isActive) {
  if (!isActive) return '< >'
  if (sortDirection === 'new') return 'NEW'
  return sortDirection === 'asc' ? '^' : 'v'
}

export default function RankList({ title, rows, defaultSortKey, sortableFields, compareDate }) {
  const isFilteredRankList = title === '條件篩選排名'
  const formattedCompareDate = formatCompareDate(compareDate)
  const changeHeaderText = formattedCompareDate === null
    ? `${TEXT.change}（vs 上週）`
    : `${TEXT.change}（vs ${formattedCompareDate}）`

  const normalizedDefaultSortKey = useMemo(
    () => normalizeSortKey(defaultSortKey, sortableFields),
    [defaultSortKey, sortableFields]
  )

  const [sortKey, setSortKey] = useState(normalizedDefaultSortKey)
  const [sortDirection, setSortDirection] = useState(DEFAULT_SORT_DIRECTION)

  useEffect(() => {
    setSortKey(normalizedDefaultSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
  }, [normalizedDefaultSortKey])

  const allowedSortableFields = useMemo(() => {
    if (!Array.isArray(sortableFields) || sortableFields.length === 0) {
      return SORTABLE_FIELD_SET
    }
    return new Set(sortableFields.filter((field) => SORTABLE_FIELD_SET.has(field)))
  }, [sortableFields])

  const sortedRows = useMemo(() => {
    const safeRows = Array.isArray(rows) ? rows : []
    const activeSortKey = normalizeSortKey(sortKey, [...allowedSortableFields])

    if (isFilteredRankList && activeSortKey === 'rank_change' && sortDirection === 'new') {
      return [...safeRows].sort((a, b) => {
        const leftIsNew = a?.change_type === 'new'
        const rightIsNew = b?.change_type === 'new'
        if (leftIsNew !== rightIsNew) return leftIsNew ? -1 : 1
        if (!leftIsNew && !rightIsNew) {
          const rankChangeCompare = compareRows(a, b, 'rank_change', 'desc')
          if (rankChangeCompare !== 0) return rankChangeCompare
        }
        return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) -
               (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
      })
    }

    return [...safeRows].sort((a, b) => compareRows(a, b, activeSortKey, sortDirection))
  }, [allowedSortableFields, isFilteredRankList, rows, sortDirection, sortKey])

  const handleSortChange = (nextSortKey) => {
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
    <div className="isolate rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto -webkit-overflow-scrolling-touch">
        
        {/* 標題列 */}
        <div className="sticky top-0 z-50 bg-white border-b border-zinc-200 min-w-[780px] shadow-sm">
          <div className="grid grid-cols-[72px_minmax(180px,280px)_92px_84px_84px_84px_190px] items-center gap-1 px-4 py-4 text-sm font-semibold text-zinc-600 bg-white">
            
            <div className="flex min-h-[52px] items-center justify-center text-center">{TEXT.rank}</div>
            
            <div className={`${STOCK_CELL_LAYOUT_CLASS} min-h-[52px] text-left`}>
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

            <button
              type="button"
              className={headerClassName(allowedSortableFields.has('rs_pct'), sortKey === 'rs_pct')}
              onClick={() => handleSortChange('rs_pct')}
            >
              <span>RS</span>
              <span className="text-xs">{sortIndicator(sortDirection, sortKey === 'rs_pct')}</span>
            </button>

            <button
              type="button"
              className={headerClassName(allowedSortableFields.has('peg_pct'), sortKey === 'peg_pct')}
              onClick={() => handleSortChange('peg_pct')}
            >
              <span>PEG</span>
              <span className="text-xs">{sortIndicator(sortDirection, sortKey === 'peg_pct')}</span>
            </button>

            <button
              type="button"
              className={headerClassName(allowedSortableFields.has('dd_pct'), sortKey === 'dd_pct')}
              onClick={() => handleSortChange('dd_pct')}
            >
              <span>DD</span>
              <span className="text-xs">{sortIndicator(sortDirection, sortKey === 'dd_pct')}</span>
            </button>

            <button
              type="button"
              className={`${headerClassName(allowedSortableFields.has('rank_change'), sortKey === 'rank_change')} col-span-1 flex items-center justify-center min-h-[52px]`}
              onClick={() => handleSortChange('rank_change')}
            >
              <span className="whitespace-nowrap text-center">{changeHeaderText}</span>
              <span className="text-xs ml-1">{sortIndicator(sortDirection, sortKey === 'rank_change')}</span>
            </button>
          </div>
        </div>

        {/* 內容列表 - 去除多餘方塊 */}
        <div className="min-w-[780px] divide-y divide-zinc-100">
          {sortedRows.map((row, index) => {
            const rankChange = formatRankChange(
              row.change_type,
              row.rank_change,
              row.prev_rank,
              row.base_rank
            )

            return (
              <div
                key={`${row.base_rank ?? index}-${row.stock_id ?? index}`}
                className="grid grid-cols-[72px_minmax(180px,280px)_92px_84px_84px_84px_190px] items-center gap-1 px-4 py-4 hover:bg-zinc-50"
              >
                <div className="text-center text-sm font-semibold tabular-nums">
                  {formatMaybeNumber(index + 1)}
                </div>

                <div className={`${STOCK_CELL_LAYOUT_CLASS} text-left text-sm tabular-nums`}>
                  <span className="font-bold text-zinc-900">{row.stock_id ?? '--'}</span>
                  <span className="min-w-0 truncate font-normal" title={row.full_name ?? ''}>
                    {row.name ?? '--'}
                  </span>
                </div>

                <div className="text-center text-sm tabular-nums">
                  <span className={scoreBadgeClass(row.display_score)}>
                    {formatScore(row.display_score)}
                  </span>
                </div>

                <div className="text-center text-sm tabular-nums">
                  <span className={`${pctBadgeClass(row.rs_pct)} opacity-80`}>
                    {formatPct(row.rs_pct)}
                  </span>
                </div>

                <div className="text-center text-sm tabular-nums">
                  <span className={`${pctBadgeClass(row.peg_pct)} opacity-80`}>
                    {formatPct(row.peg_pct)}
                  </span>
                </div>

                <div className="text-center text-sm tabular-nums">
                  <span className={`${pctBadgeClass(row.dd_pct)} opacity-80`}>
                    {formatPct(row.dd_pct)}
                  </span>
                </div>

                <div className={`col-span-1 flex flex-col items-center justify-center text-sm font-semibold tabular-nums ${rankChange.className} min-h-[52px]`}>
                  <div className="inline-flex items-center justify-center min-w-[52px]">
                    {rankChange.mainLabel}
                  </div>
                  {rankChange.detailLabel && (
                    <div className="text-xs text-zinc-500 mt-0.5 leading-tight">
                      {rankChange.detailLabel}
                    </div>
                  )}
                </div>
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
  )
}