// src/pages/CryptoPage.jsx
// 加密貨幣「品質趨勢」策略：回測績效、規則、驗證摘要、最近持倉、實盤追蹤。
// 資料：public/crypto/summary.json（由 123 repo 的 tools/export_web.py 產生）、public/crypto/live.json（實盤／紙上交易，可不存在）
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import AppSidebarLayout from '../components/AppSidebarLayout.jsx'
import { yearStartTicks } from '../lib/chartTicks.js'

const STRATEGY_COLOR = '#059669'
const BTC_COLOR = '#a1a1aa'

// 台股慣例：紅漲綠跌（與網站其他頁一致）
function toneClass(v) {
  if (v === null || v === undefined || Number.isNaN(v) || v === 0) return 'text-zinc-500'
  return v > 0 ? 'text-red-600' : 'text-green-600'
}

function fmtPct(v, digits = 1, signed = false) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  const sign = signed && v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

function fmtNum(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return v.toFixed(digits)
}

const RULES = [
  { title: '幣池', body: '幣安 USDT 現貨，近 30 日成交額前 100 名、上市滿 120 天。' },
  { title: '品質排序', body: '低波動（30 日）與流動性（30 日成交額）各占一半，取前 20 名當候選。' },
  { title: '趨勢進場', body: '候選依序挑選：收盤 ≥ 60 日高點的 90%，且相對 BTC 的強弱站上 30 日均線。最多 5 檔、每檔 20%。' },
  { title: '空位補 BTC', body: '湊不滿 5 檔時，空位改持有 BTC（BTC 本身也要符合 60 日高點條件），否則留 USDT 放活期。' },
  { title: '每日出場', body: '持有未滿 2 次調倉跌破 20 日均線、之後跌破 40 日均線，就在收盤後賣出。' },
  { title: '風險控制', body: '整體波動目標 40%（看近 14 日），波動太大時自動降低部位；資金分兩本帳，週日與週四錯開調倉。' },
]

const VALIDATION = [
  { test: '參數隨機擾動 240 組', result: '沒有任何一組年化為負，Sharpe 中位數 1.33' },
  { test: '前進式驗證（2020 起）', result: '年化 76%、最大回撤 -29%，與固定參數接近' },
  { test: '區塊拔靴法', result: '最大回撤中位數 -33%，最差 5% 情境約 -47%' },
  { test: '多重檢定（Deflated Sharpe）', result: '假設試驗 5,000 次仍顯著（99.7%）' },
  { test: '排除表現最好的幣', result: '排除 BNB、ETH、SHIB 後年化仍有 58%' },
  { test: '實盤程式逐日重播', result: '與回測日報酬相關係數 0.993' },
  { test: '收盤後延遲成交', result: '6 小時內影響不大；延遲 1 天 Calmar 明顯下降' },
]

function StatCard({ label, value, sub, valueClass = 'text-zinc-900' }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-400 tabular-nums">{sub}</div> : null}
    </div>
  )
}

function Section({ title, children, right }) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function CurveTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-md">
      <div className="mb-1 text-zinc-500">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold tabular-nums text-zinc-800">
            {p.dataKey.startsWith('dd') ? fmtPct(p.value) : `${p.value.toFixed(2)} 倍`}
          </span>
        </div>
      ))}
    </div>
  )
}

function LiveSection({ live }) {
  if (!live) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-5 text-sm text-zinc-600">
        自動交易程式上線後，這裡會每天更新紙上交易／實盤的淨值，並與回測對照。
      </div>
    )
  }
  const nav = live.nav ?? []
  const last = nav[nav.length - 1]
  const ret = last ? (last[1] / nav[0][1] - 1) * 100 : null
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-600">
        <span>模式：<b className="text-zinc-900">{live.mode === 'live' ? '實盤' : '紙上交易'}</b></span>
        <span>開始：{nav[0]?.[0] ?? '—'}</span>
        <span>最新：{last?.[0] ?? '—'}</span>
        <span>累積報酬：<b className={toneClass(ret)}>{fmtPct(ret, 2, true)}</b></span>
      </div>
      {nav.length > 1 ? (
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={nav.map(([date, v]) => ({ date, v: (v / nav[0][1] - 1) * 100 }))}>
              <CartesianGrid stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} minTickGap={40} />
              <YAxis tick={{ fontSize: 11, fill: '#71717a' }} tickFormatter={(v) => `${v.toFixed(0)}%`} width={44} />
              <Tooltip formatter={(v) => fmtPct(v, 2, true)} />
              <Line type="monotone" dataKey="v" name="累積報酬" stroke={STRATEGY_COLOR} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  )
}

export default function CryptoPage() {
  const [data, setData] = useState(null)
  const [live, setLive] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/crypto/summary.json', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`讀取資料失敗：HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => { if (!cancelled) setData(json) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : '讀取資料失敗') })
    fetch('/crypto/live.json', { cache: 'no-store' })                 // 尚未上線時不存在，忽略錯誤
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled && json?.nav?.length) setLive(json) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const s = data?.metrics?.strategy
  const b = data?.metrics?.btc
  const curve = useMemo(() => data?.curve ?? [], [data])
  const yearTicks = useMemo(() => yearStartTicks(curve), [curve])

  return (
    <AppSidebarLayout contentClassName="max-w-[960px] mx-auto">
      <header className="border-b border-zinc-200/80 pb-4">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">策略 3 · 加密貨幣</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900">品質趨勢策略</h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-zinc-600">
          在幣安成交額前 100 大的幣中，挑選低波動、高流動性、且趨勢向上的幣，最多持有 5 檔；
          全程自動下單，每天檢查出場、每週調倉兩次。
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>回測期間：{data?.start_date ?? '—'} ～ {data?.end_date ?? '—'}</span>
          <span>資料產生：{data?.generated_at ?? '—'}</span>
          <Link to="/crypto/mix" className="text-zinc-700 underline-offset-2 hover:underline">與台股策略混合配置 →</Link>
        </div>
      </header>

      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}（請確認 public/crypto/summary.json 存在）
        </div>
      ) : null}
      {!data && !error ? <div className="mt-6 text-sm text-zinc-500">資料載入中...</div> : null}

      {data ? (
        <>
          <Section title="回測績效">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="年化報酬" value={fmtPct(s.cagr)} sub={`BTC ${fmtPct(b.cagr)}`} valueClass={toneClass(s.cagr)} />
              <StatCard label="最大回撤" value={fmtPct(s.mdd)} sub={`BTC ${fmtPct(b.mdd)}`} />
              <StatCard label="年化波動" value={fmtPct(s.vol)} sub={`BTC ${fmtPct(b.vol)}`} />
              <StatCard label="Sharpe" value={fmtNum(s.sharpe)} sub={`BTC ${fmtNum(b.sharpe)}`} />
              <StatCard label="Calmar" value={fmtNum(s.calmar)} sub={`BTC ${fmtNum(b.calmar)}`} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">{data.method_note}</p>
          </Section>

          <Section title="淨值（對數刻度）">
            <div className="h-72 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} ticks={yearTicks} interval={0} tickFormatter={(d) => d.slice(0, 4)} />
                  <YAxis scale="log" domain={['auto', 'auto']} tick={{ fontSize: 11, fill: '#71717a' }} width={44}
                    tickFormatter={(v) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}x`} allowDataOverflow />
                  <Tooltip content={<CurveTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="strategy" name="策略" stroke={STRATEGY_COLOR} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="btc" name="BTC 買進持有" stroke={BTC_COLOR} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="回撤">
            <div className="h-48 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#71717a' }} ticks={yearTicks} interval={0} tickFormatter={(d) => d.slice(0, 4)} />
                  <YAxis tick={{ fontSize: 11, fill: '#71717a' }} width={44} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CurveTooltip />} />
                  <Area type="monotone" dataKey="dd_btc" name="BTC" stroke={BTC_COLOR} fill={BTC_COLOR} fillOpacity={0.15} strokeWidth={1} />
                  <Area type="monotone" dataKey="dd" name="策略" stroke={STRATEGY_COLOR} fill={STRATEGY_COLOR} fillOpacity={0.25} strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="逐年報酬">
            <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">年度</th>
                    {data.yearly.map((y) => <th key={y.year} className="px-3 py-2 text-right font-medium">{y.year}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-zinc-100">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-700">策略</td>
                    {data.yearly.map((y) => <td key={y.year} className={`px-3 py-2 text-right font-semibold ${toneClass(y.strategy)}`}>{fmtPct(y.strategy, 0, true)}</td>)}
                  </tr>
                  <tr className="border-t border-zinc-100">
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">BTC</td>
                    {data.yearly.map((y) => <td key={y.year} className={`px-3 py-2 text-right ${toneClass(y.btc)}`}>{fmtPct(y.btc, 0, true)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-zinc-500">第一年與最後一年為部分年度。</p>
          </Section>

          <Section title="實盤／紙上交易追蹤">
            <LiveSection live={live} />
          </Section>

          <Section title="最近一次調倉（回測訊號）">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(data.holdings ?? {}).map(([name, h]) => (
                <div key={name} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-zinc-900">{name} 帳 · {h.rebalance_day}收盤</div>
                  <div className="text-xs text-zinc-500">台灣時間 {h.date} 08:00 後執行</div>
                  <ul className="mt-3 space-y-1.5">
                    {h.positions.length ? h.positions.map((p) => (
                      <li key={p.coin} className="flex items-center gap-3 text-sm">
                        <span className="w-16 font-medium text-zinc-800">{p.coin}</span>
                        <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-zinc-100">
                          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${p.weight}%`, backgroundColor: STRATEGY_COLOR }} />
                        </span>
                        <span className="w-12 text-right tabular-nums text-zinc-600">{p.weight}%</span>
                      </li>
                    )) : <li className="text-sm text-zinc-500">全部持有 USDT</li>}
                  </ul>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              權重為縮放前的目標比例；實際部位另依 40% 波動目標調整（目前約 {fmtPct(data.exposure_now, 0)}），並可能因每日出場而提前賣出。
            </p>
          </Section>

          <Section title="策略規則">
            <ol className="grid gap-3 sm:grid-cols-2">
              {RULES.map((r, i) => (
                <li key={r.title} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="text-sm font-semibold text-zinc-900">{i + 1}. {r.title}</div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">{r.body}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section title="驗證摘要">
            <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <tbody>
                  {VALIDATION.map((v) => (
                    <tr key={v.test} className="border-t border-zinc-100 first:border-t-0">
                      <td className="w-2/5 px-4 py-2.5 align-top font-medium text-zinc-800">{v.test}</td>
                      <td className="px-4 py-2.5 text-zinc-600">{v.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
              回測最終設定勝過 98% 以上的隨機參數組合，屬於偏樂觀的情況；2022 年下半年以後年化約 30%。
              合理預期為<b>年化約 45%～60%、最大回撤約 -35%～-45%</b>。
            </div>
          </Section>

          <section className="mt-8 pb-10">
            <div className="rounded-xl border border-zinc-200/80 bg-white px-5 py-4">
              <h2 className="text-sm font-semibold text-zinc-900">免責聲明</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                本頁為個人研究的歷史回測結果，不構成任何投資建議。加密貨幣波動極大，可能損失全部本金。
              </p>
            </div>
          </section>
        </>
      ) : null}
    </AppSidebarLayout>
  )
}
