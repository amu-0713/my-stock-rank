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
  filterDays: '濾網天數',
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
  const base = 'inline-flex min-w-[60px] landscape:min-w-[52px] items-center justify-center rounded-full px-2 py-1 landscape:py-0.5 text-base landscape:text-xs font-semibold tabular-nums cursor-pointer hover:underline'
  if (!Number.isFinite(n)) return `${base} bg-gray-200 text-gray-700`
  if (n >= 90) return `${base} bg-red-600 text-white`
  if (n >= 80) return `${base} bg-red-400 text-white`
  if (n >= 70) return `${base} bg-red-100 text-red-700`
  if (n >= 60) return `${base} bg-gray-200 text-gray-700`
  return `${base} bg-gray-100 text-gray-400`
}

function pctBadgeClass(value) {
  const n = typeof value === 'number' ? value : Number(value)
  const base = 'inline-flex min-w-[60px] landscape:min-w-[52px] items-center justify-center rounded-full px-2 py-1 landscape:py-0.5 text-sm landscape:text-xs font-medium tabular-nums'

  if (n === 0) return `${base} bg-sky-200 text-sky-800`
  if (!Number.isFinite(n)) return `${base} bg-gray-200 text-gray-700`
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
    case 'up':
      return { mainLabel: safeChange === null ? '▲' : `▲ ${safeChange}`, detailLabel: rankRange, className: 'text-emerald-600' }
    case 'down':
      return { mainLabel: safeChange === null ? '▼' : `▼ ${safeChange}`, detailLabel: rankRange, className: 'text-rose-600' }
    case 'flat':
      return { mainLabel: '=', detailLabel: '（維持）', className: 'text-zinc-600 text-base landscape:text-xs font-bold' }
    case 'new':
      return { mainLabel: 'NEW', detailLabel: null, className: 'text-sky-600' }
    default:
      return { mainLabel: '--', detailLabel: null, className: 'text-zinc-500' }
  }
}

function getDisplayedRank(row, sortKey, isSearching, currentIndex) {
  if (isSearching) return row.base_rank
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
      <div className="relative bg-white rounded-3xl w-full max-w-lg landscape:max-w-[540px] landscape:flex shadow-2xl overflow-hidden pointer-events-auto mx-4" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="hidden landscape:block absolute top-3 right-3 z-50 p-2 text-gray-400 hover:text-zinc-900 bg-white/80 backdrop-blur-sm rounded-full transition-colors">✕</button>

        {/* 手機橫向左側欄 */}
        <div className="hidden landscape:flex landscape:flex-col landscape:w-[38%] p-4 border-r bg-zinc-50/50">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-bold text-lg text-zinc-900 leading-tight pr-4">
                {stock.name} ({stock.stock_id})
              </div>
              <div className="text-2xl font-bold text-blue-600 mt-1">
                {formatScore(stock.display_score)}
              </div>
            </div>
          </div>

          {stock.passed_filter ? (
            <div className="mt-auto rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-600 font-medium">已通過選股條件</div>
          ) : (
            stock.failed_conditions && stock.failed_conditions.length > 0 && (
              <div className="mt-auto rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                <div className="font-bold mb-0.5">未通過原因</div>
                <div className="leading-relaxed truncate-2-lines">{stock.failed_conditions.join('、')}</div>
              </div>
            )
          )}
        </div>

        {/* 右側趨勢圖區塊 */}
        <div className="w-full landscape:w-[62%]">
          <div className="p-6 border-b landscape:hidden">
            <div className="flex justify-between items-start">
              <div>
                <div className="font-bold text-2xl text-zinc-900">{stock.name} ({stock.stock_id})</div>
                <div className="text-4xl font-bold text-blue-600 mt-2">{formatScore(stock.display_score)}</div>
              </div>
              <button onClick={onClose} className="p-2 text-gray-400 hover:text-zinc-900 transition-colors">✕</button>
            </div>
          </div>

          <div className="p-6 landscape:p-4">
            <div className="text-sm font-bold text-zinc-500 mb-4 landscape:mb-1.5 uppercase tracking-wider landscape:text-xs">最近 5 個交易日分數走勢</div>

            <div className="relative h-[240px] landscape:h-[150px] w-full border border-zinc-100 rounded-2xl bg-zinc-50/50 p-4 landscape:p-2">
              <svg viewBox={`0 0 ${vWidth} ${vHeight}`} className="w-full h-full overflow-visible">
                {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
                  const y = vHeight * p
                  return <line key={i} x1="0" y1={y} x2={vWidth} y2={y} stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 4" />
                })}

                <polyline points={polylinePoints} fill="none" stroke="#8b5cf6" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />

                {pointsData.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="7" fill="#8b5cf6" stroke="#ffffff" strokeWidth="3" />
                    <text x={p.x} y={p.y - 18} textAnchor="middle" className="text-[18px] font-black tabular-nums" style={{ fill: '#4b5563', paintOrder: 'stroke', stroke: '#ffffff', strokeWidth: '4px', strokeLinejoin: 'round' }}>{p.score.toFixed(1)}</text>
                  </g>
                ))}
              </svg>
            </div>

            <div className="flex justify-between mt-3 landscape:mt-1 text-xs text-zinc-500 font-bold px-2">
              {stock.history.map((item, i) => <div key={i}>{item.date.slice(5)}</div>)}
            </div>

            <div className="landscape:hidden">
              {stock.passed_filter ? (
                <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-600 font-medium">已通過選股條件</div>
              ) : (
                stock.failed_conditions && stock.failed_conditions.length > 0 && (
                  <div className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                    <div className="font-bold mb-1">未通過原因</div>
                    <div className="leading-relaxed">{stock.failed_conditions.join('、')}</div>
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

const tooltipTexts = {
  rs_pct: `RS（相對強度指標）\n股票相對於大盤的近期表現排名\n排名越高代表近期表現越強勢\n-點擊排序-`,
  peg_pct: `PEG（本益成長比）\n成長股的估值合理性排名\n排名越高代表成長價值越佳\n-點擊排序-`,
  corr_pct: `CORR（市場相關性）\n股票與大盤的相關程度排名\n排名越高代表獨立性，分散風險效果越好\n-點擊排序-`,
  dd_pct: `DD（下行風險）\n股票短期下跌波動風險排名\n排名越高代表風險控制能力越佳\n-點擊排序-`,
  std_pct: `STD（波動度排名）\n股票短期股價波動穩定度排名\n排名越高代表股價越穩定\n-點擊排序-`,
  dy_pct: `DY（預估殖利率排名）\n股票之預估股利殖利率排名\n排名越高代表股息回報率預期越高\n-點擊排序-`
}

const DEFAULT_SORT_KEY = 'score'
const DEFAULT_SORT_DIRECTION = 'desc'
const SORTABLE_FIELD_SET_BY_STRATEGY = {
  '1': new Set(['score', 'rs_pct', 'peg_pct', 'dd_pct', 'rank_change', 'filter_days']),
  '2': new Set(['score', 'std_pct', 'dy_pct', 'rank_change']),
}
const STOCK_CELL_LAYOUT_CLASS = 'grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3 landscape:grid-cols-[56px_minmax(0,1fr)] landscape:gap-1.5'

function getSortableFieldSet(strategyId) {
  return SORTABLE_FIELD_SET_BY_STRATEGY[strategyId] ?? SORTABLE_FIELD_SET_BY_STRATEGY['1']
}

function normalizeSortKey(sortKey, sortableFields, sortableFieldSet) {
  if (typeof sortKey === 'string' && sortableFieldSet.has(sortKey) && (!Array.isArray(sortableFields) || sortableFields.includes(sortKey))) {
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
    return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) - (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
  }
  if (left === null) return 1
  if (right === null) return -1
  if (left !== right) return sortDirection === 'asc' ? left - right : right - left
  return (parseSortValue(a?.base_rank) ?? Number.MAX_SAFE_INTEGER) - (parseSortValue(b?.base_rank) ?? Number.MAX_SAFE_INTEGER)
}

function headerClassName(isClickable, isActive) {
  const base = 'flex min-h-[52px] landscape:min-h-[38px] h-full flex-col items-center justify-center bg-transparent px-1 py-1 landscape:py-0.5 text-center leading-tight transition-colors'
  if (!isClickable) return base
  return `${base} cursor-pointer select-none ${isActive ? 'text-zinc-900 font-bold' : 'hover:text-zinc-900'}`
}

function sortIndicator(sortDirection, isActive) {
  if (!isActive) return ' ↕'
  if (sortDirection === 'new') return ' NEW'
  return sortDirection === 'asc' ? ' ▲' : ' ▼'
}

export default function RankList({
  title,
  rows: initialRows,
  defaultSortKey,
  sortableFields,
  compareDate,
  strategyId = '1',
  regime,
  setRegime,
}) {
  const isFilteredRankList = title === '條件篩選排名'
  const showFilterColumn = !isFilteredRankList
  const isMarketRank = title === '市場總排名'
  const isMultiFactor = strategyId === '1'
  const isHighDividend = strategyId === '2'

  const sortableFieldSet = useMemo(() => getSortableFieldSet(strategyId), [strategyId])

  // 三頁欄位響應式對齊優化
  let gridCols = ''
  let minWidth = ''

  if (isFilteredRankList) {
    gridCols = 'grid-cols-[64px_minmax(150px,220px)_78px_70px_70px_70px_120px_80px] landscape:grid-cols-[50px_minmax(100px,140px)_65px_58px_58px_58px_100px_70px]'
    minWidth = 'min-w-[825px] landscape:min-w-[517px]'
  } else if (showFilterColumn) {
    gridCols = 'grid-cols-[64px_minmax(150px,220px)_78px_70px_70px_70px_120px_65px] landscape:grid-cols-[50px_minmax(100px,140px)_65px_58px_58px_58px_100px_55px]'
    minWidth = 'min-w-[825px] landscape:min-w-[502px]'
  } else {
    gridCols = 'grid-cols-[64px_minmax(150px,220px)_80px_75px_75px_75px_160px] landscape:grid-cols-[50px_minmax(100px,150px)_68px_62px_62px_62px_120px]'
    minWidth = 'min-w-[680px] landscape:min-w-[476px]'
  }

  const formattedCompareDate = formatCompareDate(compareDate)
  const changeHeaderText = formattedCompareDate === null ? `${TEXT.change}（vs 上週）` : `${TEXT.change}（vs ${formattedCompareDate}）`

  const normalizedDefaultSortKey = useMemo(() => normalizeSortKey(defaultSortKey, sortableFields, sortableFieldSet), [defaultSortKey, sortableFields, sortableFieldSet])

  const [sortKey, setSortKey] = useState(normalizedDefaultSortKey)
  const [sortDirection, setSortDirection] = useState(DEFAULT_SORT_DIRECTION)
  const [selectedStock, setSelectedStock] = useState(null)
  const [search, setSearch] = useState('')
  
  const [currentData, setCurrentData] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        let file = '/result.json'
        if (isHighDividend) file = '/result_2.json'
        else if (isMultiFactor && regime === 'bear') file = '/result_bear.json'
        const response = await fetch(file)
        if (!response.ok) throw new Error('無法載入資料')
        const jsonData = await response.json()
        setCurrentData(jsonData)
      } catch (error) {
        console.error('載入排名資料失敗', error)
        setCurrentData(null)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [regime, isMultiFactor, isHighDividend])

  const getRankList = (data) => {
    if (!data) return []
    if (title === '市場總排名') return data.market_rank || []
    if (title === '條件篩選排名') return data.filtered_rank || []
    if (title === '目前持股排名') return data.current_holdings_rank || []
    return []
  }

  const rows = useMemo(() => getRankList(currentData) || initialRows || [], [currentData, initialRows, title])

  const metricColumns = useMemo(() => {
    if (isMultiFactor) {
      return [
        { key: 'rs_pct', label: 'RS', sortable: true, type: 'pct' },
        { key: regime === 'bull' ? 'peg_pct' : 'corr_pct', label: regime === 'bull' ? 'PEG' : 'CORR', sortable: true, type: 'pct' },
        { key: 'dd_pct', label: 'DD', sortable: true, type: 'pct' },
      ]
    } else if (isHighDividend) {
      return [
        { key: 'std_pct', label: 'STD', sortable: true, type: 'pct' },
        { key: 'dy_pct', label: 'DY', sortable: true, type: 'pct' },
        { key: 'industry', label: '產業', sortable: false, type: 'text' },
      ]
    }
    return []
  }, [isMultiFactor, isHighDividend, regime])

  const allowedSortableFields = useMemo(() => {
    const base = Array.isArray(sortableFields) && sortableFields.length > 0
      ? new Set(sortableFields)
      : new Set(getSortableFieldSet(strategyId))
    base.add('corr_pct')
    base.add('peg_pct')
    return base
  }, [sortableFields, strategyId])

  const [visibleCount, setVisibleCount] = useState(200)

  useEffect(() => {
    setSortKey(normalizedDefaultSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
    if (isMarketRank) setVisibleCount(200)
  }, [normalizedDefaultSortKey, isMarketRank, title, regime])

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
    const safeRows = Array.isArray(filteredRows) ? filteredRows : []
    const activeSortKey = normalizeSortKey(sortKey, [...allowedSortableFields], allowedSortableFields)

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
  }, [allowedSortableFields, isFilteredRankList, filteredRows, sortDirection, sortKey])

  const displayedRows = useMemo(() => {
    if (!isMarketRank) return sortedRows
    return sortedRows.slice(0, visibleCount)
  }, [sortedRows, visibleCount, isMarketRank])

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + 200, sortedRows.length))
  }

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
      if (sortDirection === 'desc') setSortDirection('asc')
      else {
        setSortKey(normalizedDefaultSortKey)
        setSortDirection(DEFAULT_SORT_DIRECTION)
      }
      return
    }

    setSortKey(nextSortKey)
    setSortDirection(DEFAULT_SORT_DIRECTION)
  }

  return (
    <div className={`isolate flex h-full min-h-0 landscape:h-screen landscape:min-h-screen flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm max-w-[960px] mx-auto ${!!selectedStock ? 'pointer-events-none' : ''}`}>
      <div className="z-40 border-b border-zinc-200 bg-white">
        <div className="flex w-full items-center justify-between gap-3 px-4 py-3 landscape:py-1.5 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="text-sm font-semibold text-zinc-900">{title}</div>

            {isMultiFactor && (
              <button
                onClick={() => setRegime(prev => (prev === 'bull' ? 'bear' : 'bull'))}
                disabled={loading}
                className="px-6 py-1 rounded-xl border border-zinc-300 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 hidden md:flex landscape:flex"
              >
                {regime === 'bull' ? '牛市模式' : '熊市模式'}
                {loading && (
                  <div className="animate-spin h-3 w-3 border-2 border-zinc-400 border-t-transparent rounded-full"></div>
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋代號 / 名稱"
              className="h-8 landscape:h-7 w-48 landscape:w-36 rounded-lg border border-zinc-200 px-3 landscape:px-2 text-sm text-zinc-700 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="text-xs text-zinc-500 font-medium whitespace-nowrap">
              共 {sortedRows.length} 筆
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto -webkit-overflow-scrolling-touch">
        <div className={`${minWidth}`}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-96 text-zinc-500">
              <div className="animate-spin h-8 w-8 border-4 border-zinc-300 border-t-zinc-600 rounded-full mb-4"></div>
              <div className="text-sm font-medium">載入中...</div>
            </div>
          ) : (
            <>
              {/* 表頭區塊 */}
              <div className={`sticky top-0 z-10 grid ${gridCols} items-center gap-1 border-b border-zinc-200 bg-white px-4 landscape:px-3 py-3 landscape:py-0 text-sm landscape:text-xs font-semibold text-zinc-600 shadow-sm`}>
                <div className="flex min-h-[52px] landscape:min-h-[38px] items-center justify-center text-center">{TEXT.rank}</div>

                <div className={`${STOCK_CELL_LAYOUT_CLASS} min-h-[52px] landscape:min-h-[38px] text-left`}>
                  <div className="col-span-2 self-center justify-self-start text-left">{TEXT.stock}</div>
                </div>

                <button
                  type="button"
                  className={headerClassName(allowedSortableFields.has('score'), sortKey === 'score')}
                  onClick={() => handleSortChange('score')}
                >
                  <span>{TEXT.score}</span>
                  <span className="text-[10px] opacity-70">{sortIndicator(sortDirection, sortKey === 'score')}</span>
                </button>

                {metricColumns.map(column => {
                  const tooltipKey = column.key
                  const tooltip = tooltipTexts[tooltipKey] || ''

                  if (!column.sortable) {
                    return (
                      <div key={column.key} className="flex min-h-[52px] landscape:min-h-[38px] items-center justify-center text-center" title={tooltip}>
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
                      title={tooltip}
                    >
                      <span>{column.label}</span>
                      <span className="text-[10px] opacity-70">{sortIndicator(sortDirection, sortKey === column.key)}</span>
                    </button>
                  )
                })}

                <button
                  type="button"
                  className={headerClassName(allowedSortableFields.has('rank_change'), sortKey === 'rank_change')}
                  onClick={() => handleSortChange('rank_change')}
                >
                  <span className="whitespace-nowrap text-center">{changeHeaderText}</span>
                  <span className="text-[10px] opacity-70">{sortIndicator(sortDirection, sortKey === 'rank_change')}</span>
                </button>

                {isFilteredRankList && (
                  <button
                    type="button"
                    className={headerClassName(allowedSortableFields.has('filter_days'), sortKey === 'filter_days')}
                    onClick={() => handleSortChange('filter_days')}
                  >
                    <span>{TEXT.filterDays}</span>
                    <span className="text-[10px] opacity-70">{sortIndicator(sortDirection, sortKey === 'filter_days')}</span>
                  </button>
                )}

                {showFilterColumn && (
                  <div className="flex min-h-[52px] landscape:min-h-[38px] items-center justify-center text-center">
                    濾網
                  </div>
                )}
              </div>

              {/* 資料列表區塊 */}
              <div className="divide-y divide-zinc-100">
                {displayedRows.map((row, index) => {
                  const rankChange = formatRankChange(row.change_type, row.rank_change, row.prev_rank, row.base_rank)
                  const isSearching = !!search.trim()
                  const displayedRank = getDisplayedRank(row, sortKey, isSearching, index)

                  return (
                    <div
                      key={`${row.base_rank ?? index}-${row.stock_id}`}
                      className={`grid ${gridCols} items-center gap-1 px-4 landscape:px-3 py-3 landscape:py-1.5 hover:bg-zinc-50`}
                    >
                      <div className="text-center text-sm landscape:text-xs font-semibold tabular-nums text-zinc-500">
                        {formatMaybeNumber(displayedRank)}
                      </div>

                      <div className={`${STOCK_CELL_LAYOUT_CLASS} text-left text-sm landscape:text-xs tabular-nums`}>
                        <span className="font-bold text-zinc-900">{row.stock_id ?? '--'}</span>
                        <span className="min-w-0 truncate font-normal text-zinc-700" title={row.full_name ?? ''}>
                          {row.name ?? '--'}
                        </span>
                      </div>

                      <div 
                        className="text-center text-sm landscape:text-xs tabular-nums cursor-pointer" 
                        onClick={() => setSelectedStock(row)}
                        title="-點擊顯示近五日分數走勢-"
                      >
                        <span className={scoreBadgeClass(row.display_score)}>
                          {formatScore(row.display_score)}
                        </span>
                      </div>

                      {metricColumns.map(column => (
                        <div key={column.key} className="text-center text-sm landscape:text-xs tabular-nums">
                          {column.type === 'pct' ? (
                            <span className={`${pctBadgeClass(row[column.key])} opacity-85`}>
                              {formatPct(row[column.key])}
                            </span>
                          ) : (
                            <span className="inline-block max-w-full truncate text-zinc-700 font-medium" title={row[column.key] ?? ''}>
                              {row[column.key] ?? '--'}
                            </span>
                          )}
                        </div>
                      ))}

                      <div className={`flex flex-col items-center justify-center text-sm landscape:text-xs font-bold tabular-nums ${rankChange.className}`}>
                        <div>{rankChange.mainLabel}</div>
                        {rankChange.detailLabel && (
                          <div className="text-[10px] font-normal text-zinc-400 scale-95 origin-center mt-0.5 whitespace-nowrap">
                            {rankChange.detailLabel}
                          </div>
                        )}
                      </div>

                      {isFilteredRankList && (
                        <div className="flex items-center justify-center text-center text-sm landscape:text-xs tabular-nums font-semibold text-zinc-600">
                          {row.filter_days != null ? `${row.filter_days} 天` : '--'}
                        </div>
                      )}

                      {showFilterColumn && (
                        <div className="flex justify-center">
                          <button
                            type="button"
                            className="flex h-8 w-8 landscape:h-6 landscape:w-6 items-center justify-center rounded-xl hover:bg-zinc-100 transition-colors"
                            onClick={() => setSelectedStock(row)}
                            title={row.passed_filter ? '通過濾網' : '未通過濾網，點擊查看原因'}
                          >
                            {row.passed_filter ? (
                              <span className="text-lg landscape:text-sm font-black text-emerald-600">✔</span>
                            ) : (
                              <span className="text-lg landscape:text-sm font-black text-rose-500">✖</span>
                            )}
                          </button>
                        </div>
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

              {/* 載入更多區塊 */}
              {isMarketRank && displayedRows.length < sortedRows.length && (
                <div className="flex justify-center py-6 border-t">
                  <button
                    onClick={handleLoadMore}
                    className="px-6 py-2 landscape:py-1.5 bg-white border border-zinc-300 hover:border-zinc-400 text-zinc-700 text-sm font-medium rounded-xl transition-colors flex items-center gap-2 shadow-sm"
                  >
                    載入更多（已顯示 {displayedRows.length} / {sortedRows.length} 筆）
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedStock && <ScoreModal stock={selectedStock} onClose={() => setSelectedStock(null)} />}
    </div>
  )
}
