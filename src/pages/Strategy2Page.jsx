import { Link } from 'react-router-dom'

export default function Strategy2Page() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold sm:text-xl">策略2（測試中）</div>
          <div className="mt-1 text-xs text-zinc-600 sm:text-sm">
            此頁面目前為空白測試頁
          </div>
        </div>
        <Link
          to="/strategies"
          className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm hover:bg-zinc-50"
        >
          返回策略選擇
        </Link>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-sm">
        策略2（測試中）
      </div>
    </div>
  )
}

