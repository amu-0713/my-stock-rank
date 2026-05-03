import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

export default function HomePage() {
  const [data, setData] = useState(null)

  // 抓取 result.json 取得最新日期
  useEffect(() => {
    fetch('/result.json', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('讀取失敗')
        return await res.json()
      })
      .then((json) => {
        setData(json)
      })
      .catch((e) => {
        console.error('首頁讀取 result.json 失敗:', e)
        setData(null)
      })
  }, [])

  return (
    <AppSidebarLayout contentClassName="max-w-6xl">
      <div id="top">
        <header className="border-b border-zinc-200/80 pb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[1.65rem]">
            量化選股策略排名
          </h1>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-zinc-600">
            提供策略入口與最新資訊摘要，維持目前乾淨的閱讀節奏，讓使用者從首頁直接進入各策略頁面查看排名與分數表現。
          </p>
        </header>

        <section id="strategies" className="mt-10 scroll-mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">策略</h2>
          <p className="mt-1 text-sm text-zinc-600">選擇要查看的策略頁，從首頁作為主要入口進入。</p>

          <ul className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {STRATEGY_ENTRIES.map((s) => (
              <li key={s.id}>
                <Link
                  to={s.to}
                  className="group flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm transition hover:border-zinc-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-zinc-900">{s.name}</div>
                      <p className="mt-1.5 text-sm leading-snug text-zinc-600">{s.tagline}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                    <span>更新：{s.updateNote}</span>
                  </div>

                  <div className="mt-5">
                    <span className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition group-hover:bg-zinc-800">
                      進入策略
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="meta"
          className="mt-12 scroll-mt-8 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-5 py-4"
        >
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">更新與聯絡</h2>
          <dl className="mt-3 space-y-2 text-sm text-zinc-700">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-zinc-500">最近更新時間</dt>
              <dd>
                {data?.latest_date 
                  ? new Date(data.latest_date).toLocaleString('zh-TW', { 
                      year: 'numeric', 
                      month: '2-digit', 
                      day: '2-digit', 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    }) 
                  : '—'}
              </dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-zinc-500">資料來源</dt>
              <dd>量化策略整理</dd>
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-zinc-500">聯絡方式</dt>
              <dd className="text-zinc-600">請依專案既有窗口聯繫</dd>
            </div>
          </dl>
        </section>

        <section id="disclaimer" className="mt-8 scroll-mt-8 pb-10">
          <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4">
            <h2 className="text-sm font-semibold text-zinc-900">免責聲明</h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              本頁資訊僅供研究與介面展示，不構成任何投資建議。實際決策請自行評估風險並確認資料來源與時效性。
            </p>
          </div>
        </section>
      </div>
    </AppSidebarLayout>
  )
}
