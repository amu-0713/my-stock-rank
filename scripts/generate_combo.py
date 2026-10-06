# scripts/generate_combo.py
"""
合併持有模擬：讀取「動態多因子」與「高息低波」兩策略各自回測產生的「日 NAV」
（public/daily_nav.json、public/daily_nav_2.json，由兩支策略腳本輸出），
換算成日報酬後依固定比例（30/70、50/50、70/30）混合，每年第一個交易日重新平衡回目標比例，
模擬「同時持有兩策略、每年年初調回設定比例」的效果。

全程使用日報酬，績效指標的算法（日頻、252 期年化、以日曆天數算年化報酬）與兩策略腳本的 calc_performance 完全一致，
所以混合結果可以跟兩策略各自頁面的數字直接比較。

這仍是事後用兩策略的日報酬做加權混合，不是重新執行一次聯合部位回測（兩策略各自的持股、
換倉時點、現金部位互相獨立，混合時不考慮彼此的資金排擠）。

不需要 finlab／FINLAB_TOKEN，只讀取本地已經產生的日 NAV 檔，所以可以在兩支策略腳本都跑完之後完全離線執行。
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

RISK_FREE_RATE = 0.02
TRADING_DAYS = 252


def load_daily_nav(path):
    """讀取 [[日期, nav], ...] 並回傳 pd.Series（index 為日期）"""
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    if not rows:
        return pd.Series(dtype=float)
    s = pd.Series([r[1] for r in rows], index=pd.to_datetime([r[0] for r in rows]))
    return s[~s.index.duplicated(keep="last")].sort_index()


def align_daily_returns(nav_a, nav_b):
    """兩份日 NAV 先對齊到共同交易日，再各自算日報酬（第一個共同日為起點，報酬記 0，與策略腳本一致）"""
    common = nav_a.index.intersection(nav_b.index)
    nav_a, nav_b = nav_a.loc[common], nav_b.loc[common]
    return nav_a.pct_change().fillna(0), nav_b.pct_change().fillna(0)


def simulate_blend(ret_a, ret_b, w_a, w_b):
    """依目標比例混合兩策略日報酬，每年第一個交易日（先於當日報酬）重新平衡回目標比例。
    回傳以 1.0 起算的每日 NAV（Series）"""
    sub_a, sub_b = w_a, w_b
    last_year = None
    navs = []
    for dt, ra, rb in zip(ret_a.index, ret_a.values, ret_b.values):
        if last_year is not None and dt.year != last_year:
            total = sub_a + sub_b
            sub_a, sub_b = total * w_a, total * w_b
        last_year = dt.year
        sub_a *= 1 + ra
        sub_b *= 1 + rb
        navs.append(sub_a + sub_b)
    return pd.Series(navs, index=ret_a.index)


def calc_performance(nav):
    """與策略腳本 calc_performance 相同：日頻、252 期年化、以日曆天數算年化報酬"""
    ret = nav.pct_change().fillna(0)
    cum = (1 + ret).cumprod()
    total_ret = cum.iloc[-1] - 1
    years = (ret.index[-1] - ret.index[0]).days / 365.25 if len(ret) > 1 else 0
    annual_ret = (1 + total_ret) ** (1 / years) - 1 if years > 0 else 0
    max_dd = (cum / cum.cummax() - 1).min()
    vol = ret.std() * np.sqrt(TRADING_DAYS)
    sharpe = (ret.mean() * TRADING_DAYS - RISK_FREE_RATE) / vol if vol != 0 else 0
    downside_std = ret[ret < 0].std()
    sortino = (
        (ret.mean() * TRADING_DAYS - RISK_FREE_RATE) / (downside_std * np.sqrt(TRADING_DAYS))
        if downside_std and downside_std != 0 else 0
    )
    calmar = annual_ret / abs(max_dd) if max_dd != 0 else 0
    return {
        "total_return": round(float(total_ret) * 100, 2),
        "annual_return": round(float(annual_ret) * 100, 2),
        "max_drawdown": round(float(max_dd) * 100, 2),
        "volatility": round(float(vol) * 100, 2),
        "sharpe_ratio": round(float(sharpe), 2),
        "sortino_ratio": round(float(sortino), 2),
        "calmar_ratio": round(float(calmar), 2),
    }


def calc_yearly_returns(nav):
    """依日曆年切分，算每年報酬率（%）；第一年從起點 NAV=1.0 算起"""
    out = []
    prev = 1.0
    for y in sorted(nav.index.year.unique()):
        end = nav[nav.index.year == y].iloc[-1]
        out.append({"year": int(y), "return": round(float(end / prev - 1) * 100, 2)})
        prev = end
    return out


print("🚀 開始計算合併持有模擬（日報酬）...")

NAV_1 = Path("public/daily_nav.json")
NAV_2 = Path("public/daily_nav_2.json")

if not NAV_1.exists() or not NAV_2.exists():
    raise SystemExit("❌ 找不到 daily_nav.json 或 daily_nav_2.json，請先跑過兩支策略的每日更新腳本")

nav_dynamic = load_daily_nav(NAV_1)
nav_highdiv = load_daily_nav(NAV_2)

if nav_dynamic.empty or nav_highdiv.empty:
    raise SystemExit("❌ 日 NAV 檔是空的，請確認兩邊策略腳本都已更新")

ret_dynamic, ret_highdiv = align_daily_returns(nav_dynamic, nav_highdiv)
if len(ret_dynamic) < 2:
    raise SystemExit("❌ 兩策略沒有足夠的共同交易日")
print(f"✅ 兩策略共同涵蓋 {len(ret_dynamic)} 個交易日（{ret_dynamic.index[0].date()} ~ {ret_dynamic.index[-1].date()}）")

RATIOS = [
    {"key": "30_70", "label": "動態30% / 高息70%", "w_dynamic": 0.3, "w_highdiv": 0.7},
    {"key": "50_50", "label": "動態50% / 高息50%", "w_dynamic": 0.5, "w_highdiv": 0.5},
    {"key": "70_30", "label": "動態70% / 高息30%", "w_dynamic": 0.7, "w_highdiv": 0.3},
]

blends = {}
for r in RATIOS:
    nav = simulate_blend(ret_dynamic, ret_highdiv, r["w_dynamic"], r["w_highdiv"])
    blends[r["key"]] = {
        "label": r["label"],
        "w_dynamic": r["w_dynamic"],
        "w_highdiv": r["w_highdiv"],
        **calc_performance(nav),
        "yearly_returns": calc_yearly_returns(nav),
    }

combo_json = {
    "generated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d"),
    "method_note": (
        "取「動態多因子」與「高息低波」兩策略回測的每日報酬，依設定比例混合、"
        "每年第一個交易日重新平衡回目標比例，模擬同時持有兩策略的效果。"
        "績效指標與兩策略頁面採相同的日頻算法；此為事後加權混合，不是重新執行一次聯合部位回測。"
    ),
    "n_days": len(ret_dynamic),
    "start_date": str(ret_dynamic.index[0].date()),
    "end_date": str(ret_dynamic.index[-1].date()),
    "blends": blends,
}

Path("public").mkdir(parents=True, exist_ok=True)
with open("public/combo.json", "w", encoding="utf-8") as f:
    json.dump(combo_json, f, ensure_ascii=False, indent=2)

print("✅ combo.json 已產生")
for r in RATIOS:
    b = blends[r["key"]]
    print(f"  {r['label']}: 年化{b['annual_return']}% MDD{b['max_drawdown']}% Sharpe{b['sharpe_ratio']}")
