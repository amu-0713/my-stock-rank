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

# =============================================================================
# 一、資料抓取與基礎指標計算
# =============================================================================
price = data.get('price:收盤價')
open_p = data.get('price:開盤價')
yield_ratio = data.get('price_earning_ratio:殖利率(%)') / 100
vol = data.get('price:成交金額')
info = data.get('company_basic_info')

industry_map = info.set_index('stock_id')['產業類別'].astype(str)
is_fin = industry_map.str.contains('金融').fillna(False)

for df in [price, open_p, yield_ratio, vol]:
    df.columns = df.columns.astype(str)

ma240 = price.rolling(240).mean()
liq_filter = vol.rank(axis=1, pct=True) > 0.5
ma_filter = price > ma240
std240 = price.ffill().pct_change(fill_method=None).rolling(240).std()

dy_rank = yield_ratio.rank(axis=1, pct=True)
dy_filter = (dy_rank > 0.6) & (dy_rank < 0.9)

std_score = std240.rank(axis=1, pct=True, ascending=False)
dy_score = dy_rank

raw_score = dy_score * 0.33 + std_score * 0.67
score = raw_score.where(dy_filter & liq_filter & ma_filter)

full_score_matrix = raw_score.copy()

# =============================================================================
# 二、選股邏輯 + T+1 處理
# =============================================================================
max_holdings = 12
max_financial = 4
candidate_n = 25

raw_position = pd.DataFrame(0, index=score.index, columns=score.columns, dtype=float)

for dt in score.index:
    s = raw_score.loc[dt].dropna().sort_values(ascending=False).head(candidate_n)
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

limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)
cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

target_pos_qe = raw_position.resample('QE-JAN').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
blocked_buy = (buy_order & cannot_buy_t1).fillna(False)

position_final = raw_position.copy()
position_final = position_final.where(~blocked_buy, prev_position)

# =============================================================================
# 三、回測
# =============================================================================
report = sim(
    position_final,
    resample='QE-JAN',
    trade_at_price='open',
    fee_ratio=0.001425,
    tax_ratio=0.003,
    name='高股息低波動策略',
    live_performance_start='2025-12-30'
)

# =============================================================================
# 四、產生排名資料
# =============================================================================
latest_dt = score.index[-1]
print(f"✅ 使用最新完整資料日期: {latest_dt.date()}")

curr_year = latest_dt.year
curr_month = latest_dt.month
if curr_month <= 1:
    rebalance_date_str = f"{curr_year-1}-10-31"
elif 2 <= curr_month <= 4:
    rebalance_date_str = f"{curr_year}-01-31"
elif 5 <= curr_month <= 7:
    rebalance_date_str = f"{curr_year}-04-30"
elif 8 <= curr_month <= 10:
    rebalance_date_str = f"{curr_year}-07-31"
else:
    rebalance_date_str = f"{curr_year}-10-31"
real_rebalance_dt = score.index[score.index >= pd.to_datetime(rebalance_date_str)].min()

company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

def score_to_display(val):
    if pd.isna(val): return 0.0
    mapped_score = 60 + (float(val) - 0.5) / 0.4 * 40
    return round(min(float(mapped_score), 100.0), 1)

def pct_win(val):
    if pd.isna(val): return None
    return round(float(val * 100), 1)

def get_compare_dt(index, latest_dt, days=7):
    target_dt = latest_dt - pd.Timedelta(days=days)
    valid_idx = index[index <= target_dt]
    return valid_idx.max() if len(valid_idx) > 0 else None

def build_rank_map(df, score_col="score"):
    df = df.copy()
    df = df.dropna(subset=[score_col])
    df = df.sort_values(score_col, ascending=False)
    df["rank"] = range(1, len(df) + 1)
    return {str(sid): int(row["rank"]) for sid, row in df.iterrows()}

def get_rank_change_info(stock_id, prev_rank_map, current_rank, is_filtered=False):
    sid = str(stock_id)
    prev_rank = prev_rank_map.get(sid)
    if prev_rank is None:
        return None, None, "new" if is_filtered else "flat"
    rank_change = int(prev_rank - current_rank)
    change_type = "up" if rank_change > 0 else "down" if rank_change < 0 else "flat"
    return int(prev_rank), rank_change, change_type

def get_cond_value(cond_df, dt, sid):
    sid = str(sid)
    if sid not in cond_df.columns: return False
    s = cond_df[sid].loc[:dt]
    if len(s) == 0: return False
    return bool(s.iloc[-1])

def get_failed_conditions_high_div(sid, dt):
    fail = []
    if not get_cond_value(dy_filter, dt, sid):
        if get_cond_value(dy_rank >= 0.9, dt, sid):
            fail.append("殖利率過高")
        else:
            fail.append("殖利率過低")
    if not get_cond_value(liq_filter, dt, sid):
        fail.append("流通性不足")
    if not get_cond_value(ma_filter, dt, sid):
        fail.append("股價未站上年線")
    return fail

def build_stock_item_high_div(sid, row, base_rank, prev_rank_map, selected=None, passed_filter=None, is_filtered=False):
    prev_rank, rank_change, change_type = get_rank_change_info(sid, prev_rank_map, int(base_rank), is_filtered)
    item = {
        "base_rank": int(base_rank),
        "prev_rank": prev_rank,
        "rank_change": rank_change,
        "change_type": change_type,
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(sid, "")),
        "full_name": str(company_full_name_map.get(sid, "")),
        "industry": str(row.get("industry", "")),
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "dy_pct": pct_win(row.get("dy_rank")),
        "std_pct": pct_win(row.get("std_rank")),
    }
    if selected is not None: item["selected"] = bool(selected)
    if passed_filter is not None:
        item["passed_filter"] = bool(passed_filter)
        item["failed_conditions"] = [] if bool(passed_filter) else get_failed_conditions_high_div(sid, latest_dt)
    return item

def add_history_to_items(items):
    for item in items:
        sid = item["stock_id"]
        history_list = []
        current = latest_dt
        count = 0
        while count < 5:
            if current in full_score_matrix.index:
                val = full_score_matrix.loc[current, sid]
                display_score = score_to_display(val) if pd.notna(val) else 42.9
                history_list.append({"date": str(current.date()), "score": round(display_score, 1)})
                count += 1
            current = current - pd.Timedelta(days=1)
            if (latest_dt - current).days > 20: break
        item["history"] = history_list[::-1]
    return items

# ====================== 產生三種排名 ======================
compare_dt = get_compare_dt(score.index, latest_dt, days=7)
prev_current_holdings_rank_map = {}
prev_filtered_rank_map = {}
prev_market_rank_map = {}

if compare_dt is not None:
    score_prev = full_score_matrix.loc[compare_dt]
    
    # 💡 完全參考多因子處理方式：根據 compare_dt 計算當時對應的季度換股基準日
    p_year = compare_dt.year
    p_month = compare_dt.month
    if p_month <= 1:
        prev_reb_str = f"{p_year-1}-10-31"
    elif 2 <= p_month <= 4:
        prev_reb_str = f"{p_year}-01-31"
    elif 5 <= p_month <= 7:
        prev_reb_str = f"{p_year}-04-30"
    elif 8 <= p_month <= 10:
        prev_reb_str = f"{p_year}-07-31"
    else:
        prev_reb_str = f"{p_year}-10-31"
    
    # 找到 compare_dt 當時實際執行的換股交易日
    real_rebalance_dt_prev = score.index[score.index >= pd.to_datetime(prev_reb_str)].min()
    
    # 修正：從 position_final 撈出「當時換股日」鎖定的實際持股
    holdings_prev = position_final.loc[real_rebalance_dt_prev][position_final.loc[real_rebalance_dt_prev] == 1].index
    df_h_prev = pd.DataFrame({"score": score_prev.reindex(holdings_prev)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
    
    filtered_ids_prev = (dy_filter & liq_filter & ma_filter).loc[compare_dt]
    filtered_ids_prev = filtered_ids_prev[filtered_ids_prev].index
    df_f_prev = pd.DataFrame({"score": score_prev.reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
    
    df_m_prev = pd.DataFrame({"score": score_prev})
    df_m_prev = df_m_prev[df_m_prev["score"] > 0]
    prev_market_rank_map = build_rank_map(df_m_prev)

# 1. 目前持股排名（不顯示 new）
# 修正：持股名單「嚴格鎖定」在最近一次的換股交易日 (real_rebalance_dt)
# 這樣就不會撈到每天飄移的全市場前 12 名，而是真正回測持有的股票！
holdings = position_final.loc[real_rebalance_dt][position_final.loc[real_rebalance_dt] == 1].index

df_h = pd.DataFrame({
    # 雖然名單鎖定在換股日，但裡面的 score, close, 濾網狀態依然維持顯示今天 (latest_dt) 的最新數據
    "score": raw_score.loc[latest_dt].reindex(holdings),
    "close": price.loc[latest_dt].reindex(holdings),
    "dy_rank": dy_rank.loc[latest_dt].reindex(holdings),
    "std_rank": std_score.loc[latest_dt].reindex(holdings),
    "passed_filter": (dy_filter & liq_filter & ma_filter).loc[latest_dt].reindex(holdings),
    "industry": industry_map.reindex(holdings)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"], is_filtered=False) for sid, row in df_h.iterrows()]

# 2. 條件篩選排名（顯示 new）
filtered_ids = (dy_filter & liq_filter & ma_filter).loc[latest_dt]
filtered_ids = filtered_ids[filtered_ids].index
df_f = pd.DataFrame({
    "score": raw_score.loc[latest_dt].reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "dy_rank": dy_rank.loc[latest_dt].reindex(filtered_ids),
    "std_rank": std_score.loc[latest_dt].reindex(filtered_ids),
    "passed_filter": True,
    "industry": industry_map.reindex(filtered_ids)
})
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_filtered_rank_map, False, True, is_filtered=True) for sid, row in df_f.iterrows()]

# 3. 全市場排名（不顯示 new、不套濾網）
df_m = pd.DataFrame({
    "score": raw_score.loc[latest_dt],
    "close": price.loc[latest_dt],
    "dy_rank": dy_rank.loc[latest_dt],
    "std_rank": std_score.loc[latest_dt],
    "passed_filter": (dy_filter & liq_filter & ma_filter).loc[latest_dt],
    "industry": industry_map.reindex(raw_score.loc[latest_dt].index)
})
df_m = df_m[df_m["score"] > 0].copy()
df_m = df_m.sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"]), is_filtered=False) for sid, row in df_m.iterrows()]

current_holdings_rank = add_history_to_items(current_holdings_rank)
filtered_rank = add_history_to_items(filtered_rank)
market_rank = add_history_to_items(market_rank)

# =============================================================================
# 五、overview & chart_2.json
# =============================================================================
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

# =============================================================================
# 最終輸出
# =============================================================================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(real_rebalance_dt.date()),
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

print(f"✅ result_2.json & chart_2.json 已更新")
print(f"目前持股: {len(current_holdings_rank)} | 條件篩選: {len(filtered_rank)} | 全市場: {len(market_rank)}")
