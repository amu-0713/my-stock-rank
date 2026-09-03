# scripts/generate_combo.py
"""
合併持有模擬：讀取「動態多因子」與「高息低波」兩策略已經算好的 monthly_returns，
用固定比例（30/70、50/50、70/30）混合、每年1月初重新平衡回目標比例，
模擬「同時持有兩策略、每年年初調回設定比例」的效果。

這是事後用月報酬率做的近似混合計算，不是重新執行一次聯合部位回測（那需要把兩策略的持股邏輯、
換倉時點揉在一起，複雜度高很多）。純粹的後製加權平均是資產配置分析常見的做法，
數字會跟兩策略各自頁面顯示的精確逐日回測結果略有差異（因為改用月度顆粒度），
但足以回答「搭配持有能不能達到分散風險的效果」這個問題。

不需要 finlab／FINLAB_TOKEN，只讀取本地已經產生的 public/result.json 與 public/result_2.json，
所以可以在兩支策略腳本都跑完之後、完全離線執行。
"""
import json
import numpy as np
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

RISK_FREE_RATE = 0.02


def load_monthly_returns(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("overview", {}).get("monthly_returns") or []


def merge_monthly(returns_a, returns_b):
    """把兩份 monthly_returns 對齊成同一份月度序列（只取雙方都有資料的月份）"""
    map_a = {(r["year"], r["month"]): r["return"] for r in returns_a}
    map_b = {(r["year"], r["month"]): r["return"] for r in returns_b}
    common_keys = sorted(set(map_a.keys()) & set(map_b.keys()))
    return [(y, m, map_a[(y, m)], map_b[(y, m)]) for y, m in common_keys]


def simulate_blend(merged, w_a, w_b):
    """依目標比例 w_a/w_b 混合兩策略的月報酬，每年1月初重新平衡回目標比例"""
    sub_a, sub_b = w_a, w_b
    nav_points = []
    for year, month, ret_a, ret_b in merged:
        if month == 1:
            total = sub_a + sub_b
            sub_a = total * w_a
            sub_b = total * w_b
        sub_a *= (1 + ret_a / 100)
        sub_b *= (1 + ret_b / 100)
        nav_points.append({"year": year, "month": month, "nav": sub_a + sub_b})
    return nav_points


def calc_monthly_performance(nav_points):
    """用月度 NAV 序列算績效指標（用12期年化，不是逐日回測慣用的252期）"""
    navs = np.array([1.0] + [p["nav"] for p in nav_points])
    monthly_ret = navs[1:] / navs[:-1] - 1
    total_ret = navs[-1] - 1
    n_years = len(monthly_ret) / 12
    annual_ret = (1 + total_ret) ** (1 / n_years) - 1 if n_years > 0 else 0
    running_max = np.maximum.accumulate(navs)
    drawdown = navs / running_max - 1
    max_dd = drawdown.min()
    vol = monthly_ret.std() * np.sqrt(12)
    sharpe = (monthly_ret.mean() * 12 - RISK_FREE_RATE) / vol if vol != 0 else 0
    downside = monthly_ret[monthly_ret < 0]
    downside_std = downside.std() * np.sqrt(12) if len(downside) > 0 else 0
    sortino = (monthly_ret.mean() * 12 - RISK_FREE_RATE) / downside_std if downside_std != 0 else 0
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


def calc_yearly_from_nav_points(nav_points):
    """依年份切分，算每年報酬率（%），供圖表使用"""
    by_year = {}
    for p in nav_points:
        by_year.setdefault(p["year"], []).append(p)
    years = sorted(by_year.keys())
    out = []
    prev_nav = 1.0
    for y in years:
        pts = by_year[y]
        end_nav = pts[-1]["nav"]
        ret = (end_nav / prev_nav - 1) * 100
        out.append({"year": y, "return": round(ret, 2)})
        prev_nav = end_nav
    return out


print("🚀 開始計算合併持有模擬...")

RESULT_1 = Path("public/result.json")
RESULT_2 = Path("public/result_2.json")

if not RESULT_1.exists() or not RESULT_2.exists():
    raise SystemExit("❌ 找不到 result.json 或 result_2.json，請先跑過兩支策略的每日更新腳本")

returns_dynamic = load_monthly_returns(RESULT_1)
returns_highdiv = load_monthly_returns(RESULT_2)

if not returns_dynamic or not returns_highdiv:
    raise SystemExit("❌ result.json 或 result_2.json 缺少 monthly_returns，請確認兩邊腳本都已更新到含月報酬版本")

merged = merge_monthly(returns_dynamic, returns_highdiv)
print(f"✅ 兩策略共同涵蓋 {len(merged)} 個月份可用於混合模擬")

RATIOS = [
    {"key": "30_70", "label": "動態30% / 高息70%", "w_dynamic": 0.3, "w_highdiv": 0.7},
    {"key": "50_50", "label": "動態50% / 高息50%", "w_dynamic": 0.5, "w_highdiv": 0.5},
    {"key": "70_30", "label": "動態70% / 高息30%", "w_dynamic": 0.7, "w_highdiv": 0.3},
]

blends = {}
for r in RATIOS:
    nav_points = simulate_blend(merged, r["w_dynamic"], r["w_highdiv"])
    perf = calc_monthly_performance(nav_points)
    yearly = calc_yearly_from_nav_points(nav_points)
    blends[r["key"]] = {
        "label": r["label"],
        "w_dynamic": r["w_dynamic"],
        "w_highdiv": r["w_highdiv"],
        **perf,
        "yearly_returns": yearly,
    }

combo_json = {
    "generated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime("%Y-%m-%d"),
    "method_note": (
        "取「動態多因子」與「高息低波」兩策略已回測好的月報酬率，依設定比例混合、"
        "每年1月初重新平衡回目標比例，模擬同時持有兩策略的效果。此為事後用月報酬率近似混合的模擬，"
        "不是重新執行一次聯合部位回測，數字會與各自策略頁面顯示的精確逐日回測結果略有差異。"
    ),
    "n_months": len(merged),
    "blends": blends,
}

Path("public").mkdir(parents=True, exist_ok=True)
with open("public/combo.json", "w", encoding="utf-8") as f:
    json.dump(combo_json, f, ensure_ascii=False, indent=2)

print("✅ combo.json 已產生")
for r in RATIOS:
    b = blends[r["key"]]
    print(f"  {r['label']}: 年化{b['annual_return']}% MDD{b['max_drawdown']}% Sharpe{b['sharpe_ratio']}")
