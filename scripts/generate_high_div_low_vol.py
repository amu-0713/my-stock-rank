# scripts/generate_high_div_low_vol.py
import os
import finlab
import pandas as pd
import json
import numpy as np
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

from finlab import data
from finlab.backtest import sim

print("🚀 GitHub Actions 一鍵更新 高股息低波動策略...")

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")
else:
    print("⚠️ 未設定 FINLAB_TOKEN")

# ====================== 資料載入 ======================
price = data.get('price:收盤價')
open_p = data.get('price:開盤價')
yield_ratio = data.get('price_earning_ratio:殖利率(%)') / 100
vol = data.get('price:成交金額')
info = data.get('company_basic_info')

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

# ====================== 濾網條件 ======================
c_dy_filter = dy_filter
c_liq_filter = liq_filter
c_ma_filter = ma_filter
final_filter = c_dy_filter & c_liq_filter & c_ma_filter
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

# ====================== 漲停買不到處理（已修正為最穩定的寫法） ======================
limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)
cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

target_pos_qe = raw_position.resample('QE-JAN').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
blocked_buy = (buy_order & cannot_buy_t1).fillna(False)

# ←←← 這裡已改成安全的 .where() 寫法 ←←←
position_final = raw_position.copy()
position_final = position_final.where(~blocked_buy, prev_position)

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

# ====================== 公司資訊 ======================
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# ====================== 共用函數 ======================
def score_to_display(val):
    if pd.isna(val): return 0.0
    mapped_score = 60 + (float(val) - 0.5) / 0.4 * 40
    return round(min(float(mapped_score), 100.0), 1)

def pct_win(val):
    if pd.isna(val): return None
    return round(float(val * 100), 1)

def get_cond_value(cond_df, dt, sid):
    sid = str(sid)
    if sid not in cond_df.columns: return False
    s = cond_df[sid].loc[:dt]
    if len(s) == 0: return False
    return bool(s.iloc[-1])

def get_failed_conditions_high_div(sid, dt):
    fail = []
    sid = str(sid)
    if not get_cond_value(c_dy_filter, dt, sid):
        fail.append("股息率未達高息標準（0.6~0.9）")
    if not get_cond_value(c_liq_filter, dt, sid):
        fail.append("流動性不足（成交金額太低）")
    if not get_cond_value(c_ma_filter, dt, sid):
        fail.append("均線未呈多頭排列")
    return fail

def build_stock_item_high_div(sid, row, base_rank, passed_filter=None):
    item = {
        "base_rank": int(base_rank),
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(sid, "")),
        "full_name": str(company_full_name_map.get(sid, "")),
        "industry": str(row.get("industry", "")),   # ← 從 df 直接取
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "dy_pct": pct_win(row.get("dy_rank")),
        "std_pct": pct_win(row.get("std_rank")),
    }
    if passed_filter is not None:
        item["passed_filter"] = bool(passed_filter)
        item["failed_conditions"] = [] if bool(passed_filter) else get_failed_conditions_high_div(sid, latest_dt)
    return item

# ====================== 最新日期 ======================
latest_dt = score.index[-1]

# ====================== 產生三種排名（industry 已加入 df） ======================
# 1. 目前持股排名
holdings = position_final.loc[latest_dt][position_final.loc[latest_dt] == 1].index
df_h = pd.DataFrame({
    "score": score.loc[latest_dt].reindex(holdings),
    "close": price.loc[latest_dt].reindex(holdings),
    "dy_rank": dy_rank.loc[latest_dt].reindex(holdings),
    "std_rank": std_score.loc[latest_dt].reindex(holdings),
    "passed_filter": final_filter.loc[latest_dt].reindex(holdings),
    "industry": industry_map.reindex(holdings)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item_high_div(sid, row, row["base_rank"], row["passed_filter"]) for sid, row in df_h.iterrows()]

# 2. 條件篩選排名
filtered_ids = final_filter.loc[latest_dt][final_filter.loc[latest_dt]].index
df_f = pd.DataFrame({
    "score": score.loc[latest_dt].reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "dy_rank": dy_rank.loc[latest_dt].reindex(filtered_ids),
    "std_rank": std_score.loc[latest_dt].reindex(filtered_ids),
    "passed_filter": True,
    "industry": industry_map.reindex(filtered_ids)
})
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item_high_div(sid, row, row["base_rank"], True) for sid, row in df_f.iterrows()]

# 3. 全市場排名
df_m = pd.DataFrame({
    "score": score.loc[latest_dt],
    "close": price.loc[latest_dt],
    "dy_rank": dy_rank.loc[latest_dt],
    "std_rank": std_score.loc[latest_dt],
    "passed_filter": final_filter.loc[latest_dt],
    "industry": industry_map.reindex(score.loc[latest_dt].index)
})
df_m = df_m[df_m["score"] > 0].copy()
df_m = df_m.sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [build_stock_item_high_div(sid, row, row["base_rank"], bool(row["passed_filter"])) for sid, row in df_m.iterrows()]

# ====================== 計算 overview ======================
print("🚀 開始計算首頁進階指標...")
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

# ====================== chart_2.json ======================
def get_pts(series, benchmark_series, start_dt):
    if isinstance(start_dt, str):
        start_dt = pd.to_datetime(start_dt)
    else:
        start_dt = pd.to_datetime(start_dt).tz_localize(None)
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

# ====================== 最終輸出 ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "overview": overview,
    "current_holdings_rank": current_holdings_rank,
    "filtered_rank": filtered_rank,
    "market_rank": market_rank,
    "strategy_name": "高股息低波動策略"
}

public_path = Path("public")
public_path.mkdir(parents=True, exist_ok=True)

with open(public_path / "result_2.json", 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)

with open(public_path / "chart_2.json", 'w', encoding='utf-8') as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

print(f"✅ result_2.json & chart_2.json 已更新（df 已包含 industry）")
print(f"目前持股: {len(current_holdings_rank)} | 條件篩選: {len(filtered_rank)} | 全市場: {len(market_rank)}")
