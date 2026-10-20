// src/pages/CryptoMixPage.jsx
// 三策略混合配置：動態多因子、高息低波（台股）＋ 加密貨幣品質趨勢。
// 只讀取既有的 public/daily_nav.json、public/daily_nav_2.json（不修改台股資料），以及 public/crypto/daily_nav.json，
// 在瀏覽器內計算；績效算法與 scripts/generate_combo.py 相同（日頻、252 期年化、無風險利率 2%、以日曆天數算年化報酬、每年年初再平衡）。
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { yearStartTicks } from '../lib/chartTicks.js'

const TRADING_DAYS = 252
const RISK_FREE_RATE = 0.02

const ASSETS = [
  { key: 'dyn', name: '動態多因子', url: '/daily_nav.json', color: '#2563eb' },
  { key: 'hd', name: '高息低波', url: '/daily_nav_2.json', color: '#d97706' },
  { key: 'cr', name: '加密貨幣', url: '/crypto/daily_nav.json', color: '#7c3aed' },
]
const BLEND_COLOR = '#059669'

const PRESETS = [
  { label: '動態 35／高息 35／幣圈 30', w: { dyn: 35, hd: 35, cr: 30 } },
  { label: '動態 40／高息 40／幣圈 20', w: { dyn: 40, hd: 40, cr: 20 } },
  { label: '動態 70／幣圈 30', w: { dyn: 70, hd: 0, cr: 30 } },
  { label: '高息 70／幣圈 30', w: { dyn: 0, hd: 70, cr: 30 } },
  { label: '動態 50／高息 50', w: { dyn: 50, hd: 50, cr: 0 } },
  { label: '動態多因子 100', w: { dyn: 100, hd: 0, cr: 0 } },
  { label: '高息低波 100', w: { dyn: 0, hd: 100, cr: 0 } },
  { label: '加密貨幣 100', w: { dyn: 0, hd: 0, cr: 100 } },
]

// 三份淨值對齊到台股交易日；加密貨幣取「該日台灣 08:00 已收盤」的最近一筆（日期 ≤ 台股日期），不會用到未來資料
function alignReturns(navs) {
  const [dyn, hd, cr] = navs
  const hdMap = new Map(hd)
  const crStart = cr[0][0]
  const dates = dyn.map(([d]) => d).filter((d) => hdMap.has(d) && d >= crStart)
  const dynMap = new Map(dyn)
  const crVal = []
  let j = 0
  for (const d of dates) {
    while (j + 1 < cr.length && cr[j + 1][0] <= d) j += 1
    crVal.push(cr[j][1])
  }
  const series = { dyn: dates.map((d) => dynMap.get(d)), hd: dates.map((d) => hdMap.get(d)), cr: crVal }
  const rets = {}
  for (const k of Object.keys(series)) {
    rets[k] = series[k].map((v, i) => (i === 0 ? 0 : v / series[k][i - 1] - 1))
  }
  return { dates, rets }
}

function blendNav({ dates, rets }, w) {
  const keys = Object.keys(w).filter((k) => w[k] > 0)
  const total = keys.reduce((a, k) => a + w[k], 0)
  const nav = []
  let value = 1
  let hold = {}
  let year = null
  dates.forEach((d, i) => {
    const y = d.slice(0, 4)
    if (y !== year) {                                                // 每年第一個交易日再平衡
      year = y
      hold = Object.fromEntries(keys.map((k) => [k, (value * w[k]) / total]))
    }
    for (const k of keys) hold[k] *= 1 + rets[k][i]
    value = keys.reduce((a, k) => a + hold[k], 0)
    nav.push(value)
  })
  return nav
}

function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length }
function std(a) {
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}

function performance(dates, nav) {
  const ret = nav.map((v, i) => (i === 0 ? 0 : v / nav[i - 1] - 1))
  const years = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000 / 365.25
  const cagr = nav[nav.length - 1] ** (1 / years) - 1
  let peak = -Infinity
  let mdd = 0
  for (const v of nav) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1) }
  const vol = std(ret) * Math.sqrt(TRADING_DAYS)
  const sharpe = (mean(ret) * TRADING_DAYS - RISK_FREE_RATE) / vol
  const yearly = []
  let prev = 1
  dates.forEach((d, i) => {
    if (i === dates.length - 1 || dates[i + 1].slice(0, 4) !== d.slice(0, 4)) {
      yearly.push({ year: d.slice(0, 4), ret: (nav[i] / prev - 1) * 100 })
      prev = nav[i]
    }
  })
  return { cagr: cagr * 100, mdd: mdd * 100, vol: vol * 100, sharpe, calmar: cagr / Math.abs(mdd), yearly }
}

function corr(a, b) {
  const ma = mean(a)
  const mb = mean(b)
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < a.length; i += 1) {
    sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2
  }
  return sab / Math.sqrt(saa * sbb)
}

function toneClass(v) {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return 'text-zinc-500'
  return v > 0 ? 'text-red-600' : 'text-green-600'
}
const fmtPct = (v, d = 1, signed = false) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(d)}%`)

function StatCard({ label, value, valueClass = 'text-zinc-900' }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  )
}

export default function CryptoMixPage() {
  const [navs, setNavs] = useState(null)
  const [error, setError] = useState(null)
  const [w, setW] = useState(PRESETS[0].w)

  useEffect(() => {
    let cancelled = false
    Promise.all(ASSETS.map((a) => fetch(a.url, { cache: 'no-store' }).then((res) => {
      if (!res.ok) throw new Error(`讀取 ${a.url} 失敗：HTTP ${res.status}`)
      return res.json()
    })))
      .then((json) => { if (!cancelled) setNavs(json) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '讀取資料失敗') })
    return () => { cancelled = true }
  }, [])

  const aligned = useMemo(() => (navs ? alignReturns(navs) : null), [navs])
  const total = w.dyn + w.hd + w.cr

  const current = useMemo(() => {
    if (!aligned || total <= 0) return null
    const nav = blendNav(aligned, w)
    return { nav, perf: performance(aligned.dates, nav) }
  }, [aligned, w, total])

  const presetRows = useMemo(() => (
    aligned ? PRESETS.map((p) => ({ ...p, perf: performance(aligned.dates, blendNav(aligned, p.w)) })) : []
  ), [aligned])

  const chartData = useMemo(() => {
    if (!aligned || !current) return []
    const singles = Object.fromEntries(ASSETS.map((a) => [a.key, blendNav(aligned, { [a.key]: 1 })]))
    const step = Math.max(1, Math.floor(aligned.dates.length / 400))     // 抽樣，避免圖太密
    const out = []
    aligned.dates.forEach((d, i) => {
      if (i % step === 0 || i === aligned.dates.length - 1) {
        out.push({ date: d, blend: current.nav[i], ...Object.fromEntries(ASSETS.map((a) => [a.key, singles[a.key][i]])) })
      }
    })
    return out
  }, [aligned, current])

  const yearTicks = useMemo(() => yearStartTicks(chartData), [chartData])

  const corrMatrix = useMemo(() => {
    if (!aligned) return null
    return ASSETS.map((a) => ASSETS.map((b) => corr(aligned.rets[a.key].slice(1), aligned.rets[b.key].slice(1))))
  }, [aligned])

  const setWeight = (key, value) => setW((prev) => ({ ...prev, [key]: Number(value) }))
  const p = current?.perf

  return (
    <AppSidebarLayout contentClassName="max-w-[960px] mx-auto">
      <header className="border-b border-zinc-200/80 pb-4">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">混合配置 · 台股 × 加密貨幣</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">三策略混合模擬</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600">
          加密貨幣策略與兩個台股策略的日報酬相關性接近 0，混合持有可以在報酬相近的情況下明顯降低回撤。
          調整比例即可即時試算。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>期間：{aligned ? `${aligned.dates[0]} ～ ${aligned.dates[aligned.dates.length - 1]}` : '—'}</span>
          <Link to="/crypto" className="text-zinc-700 underline-offset-2 hover:underline">← 加密貨幣策略</Link>
        </div>
      </header>

      {error ? <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {!aligned && !error ? <div className="mt-6 text-sm text-zinc-500">資料載入中...</div> : null}

      {aligned ? (
        <>
          <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-wrap gap-2">
              {PRESETS.slice(0, 5).map((pr) => (
                <button key={pr.label} type="button" onClick={() => setW(pr.w)}
                  className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                    pr.w.dyn === w.dyn && pr.w.hd === w.hd && pr.w.cr === w.cr
                      ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}>
                  {pr.label}
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {ASSETS.map((a) => (
                <label key={a.key} className="block text-sm">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-zinc-700">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />{a.name}
                    </span>
                    <span className="tabular-nums font-semibold text-zinc-900">
                      {total > 0 ? Math.round((w[a.key] / total) * 100) : 0}%
                    </span>
                  </div>
                  <input type="range" min="0" max="100" step="5" value={w[a.key]}
                    onChange={(e) => setWeight(a.key, e.target.value)} className="mt-2 w-full accent-zinc-900" />
                </label>
              ))}
            </div>
            {total !== 100 && total > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">比例合計 {total}，已依比例換算成 100%。</p>
            ) : null}
            {total === 0 ? <p className="mt-2 text-xs text-red-600">請至少設定一個策略的比例。</p> : null}
          </section>

          {p ? (
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="年化報酬" value={fmtPct(p.cagr)} valueClass={toneClass(p.cagr)} />
              <StatCard label="最大回撤" value={fmtPct(p.mdd)} />
              <StatCard label="年化波動" value={fmtPct(p.vol)} />
              <StatCard label="Sharpe" value={p.sharpe.toFixed(2)} />
              <StatCard label="Calmar" value={p.calmar.toFixed(2)} />
            </section>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold text-zinc-900">淨值（對數刻度）</h2>
            <div className="mt-3 h-72 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} ticks={yearTicks} interval={0} tickFormatter={(d) => d.slice(0, 4)} />
                  <YAxis scale="log" domain={['auto', 'auto']} allowDataOverflow tick={{ fontSize: 11, fill: '#71717a' }} width={44}
                    tickFormatter={(v) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}x`} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)} 倍`} labelStyle={{ color: '#71717a' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {ASSETS.map((a) => (
                    <Line key={a.key} type="monotone" dataKey={a.key} name={a.name} stroke={a.color} strokeWidth={1}
                      strokeOpacity={0.45} dot={false} />
                  ))}
                  <Line type="monotone" dataKey="blend" name="混合配置" stroke={BLEND_COLOR} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {p ? (
            <section className="mt-6">
              <h2 className="text-base font-semibold text-zinc-900">逐年報酬（目前比例）</h2>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>{p.yearly.map((y) => <th key={y.year} className="px-3 py-2 text-right font-medium">{y.year}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr>{p.yearly.map((y) => <td key={y.year} className={`px-3 py-2 text-right font-semibold ${toneClass(y.ret)}`}>{fmtPct(y.ret, 0, true)}</td>)}</tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-zinc-500">第一年與最後一年為部分年度。</p>
            </section>
          ) : null}

          <section className="mt-6">
            <h2 className="text-base font-semibold text-zinc-900">常見配置比較</h2>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">配置</th>
                    <th className="px-3 py-2 text-right font-medium">年化</th>
                    <th className="px-3 py-2 text-right font-medium">最大回撤</th>
                    <th className="px-3 py-2 text-right font-medium">波動</th>
                    <th className="px-3 py-2 text-right font-medium">Sharpe</th>
                    <th className="px-3 py-2 text-right font-medium">Calmar</th>
                  </tr>
                </thead>
                <tbody>
                  {presetRows.map((r) => (
                    <tr key={r.label} onClick={() => setW(r.w)} className="cursor-pointer border-t border-zinc-100 hover:bg-zinc-50">
                      <td className="whitespace-nowrap px-3 py-2 text-zinc-700">{r.label}</td>
                      <td className={`px-3 py-2 text-right ${toneClass(r.perf.cagr)}`}>{fmtPct(r.perf.cagr)}</td>
                      <td className="px-3 py-2 text-right text-zinc-700">{fmtPct(r.perf.mdd)}</td>
                      <td className="px-3 py-2 text-right text-zinc-700">{fmtPct(r.perf.vol)}</td>
                      <td className="px-3 py-2 text-right text-zinc-700">{r.perf.sharpe.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-zinc-700">{r.perf.calmar.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {corrMatrix ? (
            <section className="mt-6">
              <h2 className="text-base font-semibold text-zinc-900">日報酬相關係數</h2>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-zinc-50 text-xs text-zinc-500">
                    <tr>
                      <th className="px-3 py-2" />
                      {ASSETS.map((a) => <th key={a.key} className="px-3 py-2 text-right font-medium">{a.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ASSETS.map((a, i) => (
                      <tr key={a.key} className="border-t border-zinc-100">
                        <td className="px-3 py-2 text-zinc-700">{a.name}</td>
                        {corrMatrix[i].map((c, j) => (
                          <td key={ASSETS[j].key} className={`px-3 py-2 text-right ${i === j ? 'text-zinc-300' : 'text-zinc-800'}`}>{c.toFixed(2)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <section className="mt-8 pb-10">
            <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4 text-sm leading-relaxed text-zinc-600">
              <h2 className="text-sm font-semibold text-zinc-900">計算方式與免責聲明</h2>
              <p className="mt-2">
                以三個策略各自回測的每日淨值換算日報酬，依比例混合、每年第一個交易日再平衡；績效算法與台股合併持有頁相同
                （252 期年化、無風險利率 2%）。加密貨幣以台股交易日當天台灣 08:00 的收盤淨值對齊。
                此為事後加權混合，不考慮兩個市場之間的匯兌與出入金成本，也不構成任何投資建議。
              </p>
            </div>
          </section>
        </>
      ) : null}
    </AppSidebarLayout>
  )
}
