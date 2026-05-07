import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { STRATEGY_ENTRIES } from '../data/strategyEntries.js'

export default function HomePage() {
  const [data, setData] = useState(null)
  const [selectedPeriod, setSelectedPeriod] = useState('YTD')

  // 抓取 result.json
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

  const overview = data?.overview || {}

  return (
    <AppSidebarLayout contentClassName="max-w-6xl">
      <div id="top">
        <header className="border-b border-zinc-200/80 pb-4">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-[1.65rem]">
            量化選股策略排名
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-zinc-600">
            提供策略入口與最新資訊摘要，維持目前乾淨的閱讀節奏，讓使用者從首頁直接進入各策略頁面查看排名與分數表現。
          </p>
        </header>

        <section id="strategies" className="mt-3 scroll-mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">策略</h2>
          <p className="mt-1 text-sm text-zinc-600">選擇要查看的策略頁，從首頁作為主要入口進入。</p>

          <ul className="mt-3 grid gap-4 sm:grid-cols-2 sm:gap-5">
            {STRATEGY_ENTRIES.map((s) => {
              if (s.name === '動態多因子') {
                return (
                  <li key={s.id}>
                    <div className="group flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-sm transition hover:border-zinc-300 hover:shadow-md">
                      
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-semibold text-zinc-900">{s.name}</div>
                          <p className="mt-1.5 text-sm leading-snug text-zinc-600">{s.tagline}</p>
                        </div>
                        <Link
                          to={s.to}
                          className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition group-hover:bg-zinc-800 whitespace-nowrap"
                        >
                          進入策略
                        </Link>
                      </div>

                      <p className="mt-3 text-sm text-zinc-500">
                        回測期間：2010 - {data?.latest_date ? new Date(data.latest_date).getFullYear() : '2026'}
                      </p>

                      {/* 時間切換按鈕 + 圖表切換 */}
                      <div className="mt-4 mb-4">
                        <div className="flex gap-2">
                          {['YTD', '1Y', '5Y', 'ALL'].map((period) => (
                            <button
                              key={period}
                              onClick={() => setSelectedPeriod(period)}
                              className={`px-4 py-1.5 text-sm font-medium rounded-xl transition flex-1 ${
                                selectedPeriod === period
                                  ? 'bg-zinc-900 text-white shadow'
                                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                              }`}
                            >
                              {period}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 圖表區 - 動態切換 */}
                      <div className="bg-zinc-50 border border-dashed border-zinc-300 rounded-2xl h-[280px] flex items-center justify-center mb-3 overflow-hidden">
                        <img
                          src={`/charts/cumulative_${selectedPeriod.toLowerCase()}.png`}
                          alt={`策略 vs 大盤績效 ${selectedPeriod}`}
                          className="max-h-full max-w-full object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.innerHTML = `
                              <div class="text-center">
                                <div class="text-5xl mb-3 opacity-40">📈</div>
                                <p class="font-medium text-zinc-400">策略 vs 大盤績效 (${selectedPeriod})</p>
                                <p class="text-xs text-zinc-400 mt-1">圖表由 GitHub Actions 自動更新</p>
                              </div>
                            `;
                          }}
                        />
                      </div>

                      {/* KPI 小卡 */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div className="rounded-2xl bg-white border p-2.5">
                          <div className="flex items-center gap-2 text-emerald-600">
                            <span className="text-lg">📈</span>
                            <span className="text-[16px] font-medium">年化報酬</span>
                          </div>
                          <div className="mt-2 text-[24px] font-bold text-emerald-600">
                            +{overview.annual_return_all?.toFixed(1) || '—'}%
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white border p-2.5">
                          <div className="flex items-center gap-2 text-red-600">
                            <span className="text-lg">📉</span>
                            <span className="text-[16px] font-medium">最大回撤</span>
                          </div>
                          <div className="mt-2 text-[24px] font-bold text-red-600">
                            {overview.max_drawdown?.toFixed(1) || '—'}%
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white border p-2.5">
                          <div className="flex items-center gap-2 text-blue-600">
                            <span className="text-lg">📊</span>
                            <span className="text-[16px] font-medium">夏普比率</span>
                          </div>
                          <div className="mt-2 text-[24px] font-bold text-blue-600">
                            {overview.sharpe_ratio?.toFixed(2) || '—'}
                          </div>
                        </div>

                        <div className="rounded-2xl bg-white border p-2.5">
                          <div className="flex items-center gap-2 text-emerald-600">
                            <span className="text-lg">📅</span>
                            <span className="text-[16px] font-medium">今年報酬</span>
                          </div>
                          <div className="mt-2 text-[24px] font-bold text-emerald-600">
                            +{overview.total_return_ytd?.toFixed(1) || '—'}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              }

              // 其他策略保持原本樣子
              return (
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
              )
            })}
          </ul>
        </section>

        {/* 更新與聯絡、免責聲明保持不變 */}
        <section id="meta" className="mt-12 scroll-mt-8 rounded-xl border border-zinc-200/80 bg-zinc-50/80 px-5 py-4">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">更新與聯絡</h2>
          <dl className="mt-3 space-y-2 text-sm text-zinc-700">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              <dt className="text-zinc-500">最近更新時間</dt>
              <dd>
                {data?.updated_at ? data.updated_at : (data?.latest_date ? `${data.latest_date} 晚上更新` : '—')}
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
