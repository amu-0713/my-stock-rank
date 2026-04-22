import { Link } from 'react-router-dom'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

export default function StrategySelectPage() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold sm:text-xl">選擇策略</div>
          <div className="mt-1 text-xs text-zinc-600 sm:text-sm">
            請選擇要查看的排名與持股
          </div>
        </div>
        <Link
          to="/"
          className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
        >
          返回首頁
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4">
        {STRATEGY_ENTRIES.map((s) => (
          <Link
            key={s.id}
            to={s.to}
            className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
          >
            <div className="text-base font-semibold text-zinc-900">{s.name}</div>
            <div className="mt-1 text-sm text-zinc-600">{s.tagline}</div>
            <div className="mt-3 text-xs text-zinc-500">更新：{s.updateNote}</div>
            <span className="mt-4 inline-flex w-fit items-center rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white group-hover:bg-zinc-800">
              進入策略
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

