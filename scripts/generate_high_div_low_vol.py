# scripts/generate_high_div_low_vol.py
from finlab import data
from finlab.backtest import sim
import pandas as pd
import numpy as np
import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

print("🚀 執行 高股息低波動策略 回測與 JSON 產生...")

# ====================== 資料載入 ======================
price = data.get('price:收盤價')
open_p = data.get('price:開盤價')
yield_ratio = data.get('price_earning_ratio:殖利率(%)') / 100
vol = data.get('price:成交金額')
info = data.get('company_basic_info')

# === 產業名稱（重點新增）===
industry_map = info.set_index('stock_id')['產業類別'].astype(str)
is_fin = industry_map.str.contains('金融').fillna(False)

for df in [price, open_p, yield_ratio, vol]:
    df.columns = df.columns.astype(str)

# ====================== 因子計算 ======================
ma240 = price.rolling(240).mean()
liq_filter = vol.rank(axis=1, pct=True) > 0.5
ma_filter = price > ma240
std240 = price.ffill().pct_change(fill_method=None).rolling(240).std()

dy_rank = yield_ratio.rank(axis=1, pct=True)
dy_filter = (dy_rank > 0.6) & (dy_rank < 0.9)

std_score = std240.rank(axis=1, pct=True, ascending=False)
dy_score = dy_rank
score = dy_score * 0.33 + std_score * 0.67

final_filter = dy_filter & liq_filter & ma_filter
score = score.where(final_filter)

# ====================== 選股邏輯 ======================
max_holdings = 12
max_financial = 4
candidate_n = 25

raw_position = pd.DataFrame(0, index=score.index, columns=score.columns, dtype=int)

for dt in score.index:
    s = score.loc[dt].dropna().sort_values(ascending=False).head(candidate_n)
    
    fin_selected, non_selected = [], []
    for stock in s.index:
        if is_fin.get(stock, False):
            if len(fin_selected) < max_financial:
                fin_selected.append(stock)
        else:
            non_selected.append(stock)
        if len(fin_selected) + len(non_selected) >= max_holdings:
            break
    
    selected = fin_selected + non_selected
    if len(selected) < max_holdings:
        remaining = [stk for stk in s.index if stk not in selected]
        for stock in remaining:
            if is_fin.get(stock, False) and len(fin_selected) >= max_financial:
                continue
            selected.append(stock)
            if is_fin.get(stock, False):
                fin_selected.append(stock)
            if len(selected) >= max_holdings:
                break
    raw_position.loc[dt, selected] = 1

# ====================== 漲停買不到處理 ======================
limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)
cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

target_pos_qe = raw_position.resample('QE-JAN').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
position_final = raw_position.copy()
blocked_buy = (buy_order & cannot_buy_t1).fillna(False)
position_final[blocked_buy] = prev_position[blocked_buy]

# ====================== 回測 ======================
report = sim(
    position_final,
    resample='QE-JAN',
    trade_at_price='open',
    fee_ratio=0.001425,
    tax_ratio=0.003,
    name='高股息低波動策略',
    live_performance_start='2025-12-30',
    upload=True
)

print("✅ 高股息低波動策略 回測完成")
report.display()

# ====================== 共用函數 ======================
def score_to_display(val):
    if pd.isna(val): return 0.0
    mapped = 60 + (float(val) - 0.5) / 0.4 * 40
    return round(min(float(mapped), 100.0), 1)

def pct_win(val):
    return round(float(val * 100), 1) if pd.notna(val) else None

company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# ====================== 產生目前持股排名（新增產業名稱） ======================
latest_dt = score.index[-1]
holdings = position_final.loc[latest_dt][position_final.loc[latest_dt] == 1].index

df_h = pd.DataFrame({
    "score": score.loc[latest_dt].reindex(holdings),
    "close": price.loc[latest_dt].reindex(holdings),
    "dy_rank": dy_rank.loc[latest_dt].reindex(holdings),
    "std_rank": std_score.loc[latest_dt].reindex(holdings),
})

df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)

current_holdings_rank = []
for sid, row in df_h.iterrows():
    item = {
        "base_rank": int(row["base_rank"]),
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(sid, "")),
        "full_name": str(company_full_name_map.get(sid, "")),
        "industry": str(industry_map.get(sid, "")),          # ← 新增產業名稱
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "dy_pct": pct_win(row.get("dy_rank")),
        "std_pct": pct_win(row.get("std_rank")),
        "passed_filter": True,
        "failed_conditions": []
    }
    current_holdings_rank.append(item)

# ====================== KPI & Chart（跟主策略一樣） ======================
daily_return = report.creturn.pct_change().fillna(0)

def calc_performance(ret_series, start_date=None):
    if start_date:
        ret_series = ret_series.loc[start_date:]
    cum = (1 + ret_series).cumprod()
    total_ret = (cum.iloc[-1] - 1) * 100 if len(cum) > 0 else 0
    days = (ret_series.index[-1] - ret_series.index[0]).days if len(ret_series) > 1 else 1
    years = days / 365.25
    annual_ret = ((1 + total_ret/100) ** (1/years) - 1) * 100 if years > 0 else 0
    max_dd = ((cum / cum.cummax()) - 1).min() * 100
    sharpe = (ret_series.mean() * 252 - 0.02) / (ret_series.std() * np.sqrt(252)) if ret_series.std() != 0 else 0
    return {
        "total_return": round(total_ret, 2),
        "annual_return": round(annual_ret, 2),
        "max_drawdown": round(max_dd, 2),
        "sharpe_ratio": round(sharpe, 2)
    }

overview = {
    "start_date": "2010-03-31",
    "total_return_all": calc_performance(daily_return)["total_return"],
    "annual_return_all": calc_performance(daily_return)["annual_return"],
    "total_return_ytd": calc_performance(daily_return, f"{datetime.now().year}-01-01")["total_return"],
    "total_return_1y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-1))["total_return"],
    "max_drawdown": calc_performance(daily_return)["max_drawdown"],
    "sharpe_ratio": calc_performance(daily_return)["sharpe_ratio"],
    "current_holdings": len(holdings)
}

# Chart Data
def get_pts(series, benchmark_series, start_dt):
    if isinstance(start_dt, str):
        start_dt = pd.to_datetime(start_dt)
    mask = series.index >= start_dt
    target = series[mask]
    target_bench = benchmark_series.reindex(target.index).ffill()
    if len(target) == 0:
        return []
    base = target.iloc[0]
    base_bench = target_bench.iloc[0]
    norm = ((target / base) - 1) * 100
    norm_bench = ((target_bench / base_bench) - 1) * 100
    return [{"date": d.strftime('%Y-%m-%d'), "returns": round(float(norm.loc[d]), 2), "benchmark": round(float(norm_bench.loc[d]), 2)} for d in target.index]

now = datetime.now(ZoneInfo("Asia/Taipei"))
chart_json = {
    "今年": get_pts(report.creturn, report.benchmark, f"{now.year}-01-01"),
    "1年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=365)),
    "5年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=5*365)),
    "全部": get_pts(report.creturn, report.benchmark, report.creturn.index.min())
}

# ====================== 輸出 JSON ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "overview": overview,
    "current_holdings_rank": current_holdings_rank,
    "strategy_name": "高股息低波動策略"
}

public_path = Path("public")
public_path.mkdir(parents=True, exist_ok=True)

with open(public_path / "result_2.json", 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)

with open(public_path / "chart_2.json", 'w', encoding='utf-8') as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

print(f"✅ result_2.json & chart_2.json 已產生！（已包含產業名稱）")
print(f"目前持股數量: {len(holdings)} 檔")
print(f"今年報酬: +{overview['total_return_ytd']}%")
