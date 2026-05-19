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

print("🚀 執行：高息低波策略（排除 NaN 分母污染修正版）自動化更新...")

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")
else:
    print("⚠️ 未設定 FINLAB_TOKEN，嘗試使用本地快取資料")

# =============================================================================
# 一、資料抓取與基礎指標計算
# =============================================================================
price = data.get('price:收盤價')
open_p = data.get('price:開盤價')
yield_ratio = data.get('price_earning_ratio:殖利率(%)') / 100
vol = data.get('price:成交金額')

# === 二、產業資料（金融判定）===
info = data.get('company_basic_info')
industry_map = info.set_index('stock_id')['產業類別'].astype(str)
is_fin = industry_map.str.contains('金融').fillna(False)

# 對齊欄位格式
for df in [price, open_p, yield_ratio, vol]:
    df.columns = df.columns.astype(str)

# === 三、因子 ===
ma240 = price.rolling(240).mean()

# 三大濾網
liq_filter = vol.rank(axis=1, pct=True) > 0.5
ma_filter = price > ma240

std240 = price.ffill().pct_change(fill_method=None).rolling(240).std()
dy_rank = yield_ratio.rank(axis=1, pct=True)
dy_filter = (dy_rank > 0.6) & (dy_rank < 0.9)

# 綜合濾網 (維持布林矩陣，不用來覆蓋分數)
final_cond = dy_filter & liq_filter & ma_filter

# === 四、評分 (維持全市場完整原始分數，方向與你原本的完全一致) ===
std_score = std240.rank(axis=1, pct=True, ascending=False)
dy_score = dy_rank
score_raw_today = dy_score * 0.33 + std_score * 0.67

# =============================================================================
# 五、選股迴圈（只有在回測選股時，才用 final_cond 去排除不符資格的股票）
# =============================================================================
max_holdings = 12
max_financial = 4
candidate_n = 25

# 這裡把分數套上濾網，只給歷史選股迴圈內部使用
loop_score = score_raw_today.where(final_cond)

raw_position = pd.DataFrame(0, index=loop_score.index, columns=loop_score.columns, dtype=int)

for dt in loop_score.index:
    row_score = loop_score.loc[dt].dropna()
    if len(row_score) == 0:
        continue
        
    s = row_score.sort_values(ascending=False).head(candidate_n)

    fin_selected = []
    non_selected = []

    for stock in s.index:
        fin_flag = is_fin.get(stock, False)

        if fin_flag:
            if len(fin_selected) < max_financial:
                fin_selected.append(stock)
        else:
            non_selected.append(stock)

        if len(fin_selected) + len(non_selected) >= max_holdings:
            break

    selected = fin_selected + non_selected

    # 若不足12檔，用剩餘候選補滿
    if len(selected) < max_holdings:
        remaining = [stk for stk in s.index if stk not in selected]
        for stock in remaining:
            fin_flag = is_fin.get(stock, False)

            if fin_flag and len(fin_selected) >= max_financial:
                continue

            selected.append(stock)
            if fin_flag:
                fin_selected.append(stock)

            if len(selected) >= max_holdings:
                break

    raw_position.loc[dt, selected] = 1

# =============================================================================
# 六、漲停買不到濾網 (完全對齊原始回測機制)
# =============================================================================
limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)

cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next
cannot_buy_t1 = cannot_buy_t1.reindex_like(raw_position).fillna(False)

target_pos_qe = raw_position.resample('QE-JAN').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
position_final_x = raw_position.copy()

blocked_buy = (buy_order & cannot_buy_t1).astype(bool)
position_final_x[blocked_buy] = prev_position[blocked_buy]

# =============================================================================
# 七、執行回測
# =============================================================================
report_x = sim(
    position_final_x,
    resample='QE-JAN',
    trade_at_price='open',
    fee_ratio=0.001425,
    tax_ratio=0.003,
    name='高息低波策略',
    live_performance_start='2025-12-30',
    upload=True
)

if not hasattr(report_x, 'benchmark') or report_x.benchmark is None:
    print("⚠️ 手動補充 benchmark（加權指數）")
    benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
    report_x.benchmark = benchmark.reindex(report_x.creturn.index).ffill()

print("✅ 回測執行完成！開始精準生成三頁排名資料...")

# =============================================================================
# 八、精準脫水前端 JSON 生成邏輯 (完全套用範例架構)
# =============================================================================
latest_dt = score_raw_today.index[-1]
print(f"✅ 使用最新完整資料日期: {latest_dt.date()}")

# QE-JAN 季度基準日計算邏輯
def get_rebalance_date_qe_jan(dt):
    y, m = dt.year, dt.month
    if m <= 1:   return pd.Timestamp(f"{y-1}-10-31")
    elif m <= 4: return pd.Timestamp(f"{y}-01-31")
    elif m <= 7: return pd.Timestamp(f"{y}-04-30")
    elif m <= 10: return pd.Timestamp(f"{y}-07-31")
    else:        return pd.Timestamp(f"{y}-10-31")

real_rebalance_dt = get_rebalance_date_qe_jan(latest_dt)
print(f"✅ 本季換股基準日: {real_rebalance_dt.date()}")

# ====================== 公司資訊 ======================
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# ====================== 共用函數 ======================
def score_to_display(val):
    if pd.isna(val): return 42.9 # 依照範例給予一個預設基本分數，不因 NaN 導致前端報錯
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
    df = df.copy().dropna(subset=[score_col])
    df = df.sort_values(score_col, ascending=False)
    df["rank"] = range(1, len(df) + 1)
    return {str(sid): int(row["rank"]) for sid, row in df.iterrows()}

def get_rank_change_info(stock_id, prev_rank_map, current_rank):
    sid = str(stock_id)
    prev_rank = prev_rank_map.get(sid)
    if prev_rank is None:
        return None, None, "new"
    rank_change = int(prev_rank - current_rank)
    change_type = "up" if rank_change > 0 else "down" if rank_change < 0 else "flat"
    return int(prev_rank), rank_change, change_type

# 原始三大濾網切片 (用來回推失敗原因)
dy_filter_series = dy_filter.loc[latest_dt]
liq_filter_series = liq_filter.loc[latest_dt]
ma_filter_series = ma_filter.loc[latest_dt]
dy_rank_series = dy_rank.loc[latest_dt]

def get_failed_conditions_high_div(sid):
    fail = []
    sid_str = str(sid)
    
    # 1. 殖利率區間檢查
    if not dy_filter_series.get(sid_str, False):
        dy_val = dy_rank_series.get(sid_str, np.nan)
        if pd.notna(dy_val) and (dy_val <= 0.6 or dy_val >= 0.9):
            fail.append("殖利率未在60%-90%間")
        else:
            fail.append("殖利率異常")
            
    # 2. 流通性檢查
    if not liq_filter_series.get(sid_str, False):
        fail.append("流通性不足")
        
    # 3. 年線檢查
    if not ma_filter_series.get(sid_str, False):
        fail.append("股價未站上年線")
        
    return fail

def build_stock_item_high_div(sid, row, base_rank, prev_rank_map, selected=None, passed_filter=None):
    prev_rank, rank_change, change_type = get_rank_change_info(sid, prev_rank_map, int(base_rank))
    item = {
        "base_rank": int(base_rank),
        "prev_rank": prev_rank,
        "rank_change": rank_change,
        "change_type": change_type,
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(str(sid), "")),
        "full_name": str(company_full_name_map.get(str(sid), "")),
        "industry": str(industry_map.get(str(sid), "")), 
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "dy_pct": pct_win(row.get("dy_rank")),          
        "std_pct": pct_win(row.get("std_rank")),          
    }
    if selected is not None: item["selected"] = bool(selected)
    if passed_filter is not None:
        item["passed_filter"] = bool(passed_filter)
        item["failed_conditions"] = [] if bool(passed_filter) else get_failed_conditions_high_div(sid)
    return item

def add_history_to_items(items):
    if len(items) == 0: return items
    past_dates = score_raw_today.index[-5:]
    sub_df = score_raw_today.loc[past_dates].map(score_to_display)
    
    history_dict = {}
    for sid in sub_df.columns:
        history_dict[str(sid)] = [
            {"date": str(dt.date()), "score": round(float(sub_df.loc[dt, sid]), 1)}
            for dt in past_dates
        ]
    for item in items:
        sid = item["stock_id"]
        item["history"] = history_dict.get(sid, [])
    return items

# ====================== 產生歷史固定持股名單 ======================
rb_score = loop_score.loc[real_rebalance_dt].dropna().sort_values(ascending=False).head(candidate_n)
fin_selected_rb = []
non_selected_rb = []
for stock in rb_score.index:
    if is_fin.get(stock, False):
        if len(fin_selected_rb) < max_financial: 
            fin_selected_rb.append(stock)
    else:
        non_selected_rb.append(stock)
    if len(fin_selected_rb) + len(non_selected_rb) >= max_holdings: 
        break
fixed_hold_ids = fin_selected_rb + non_selected_rb

if len(fixed_hold_ids) < max_holdings:
    remaining_rb = [stk for stk in rb_score.index if stk not in fixed_hold_ids]
    for stock in remaining_rb:
        f_flag = is_fin.get(stock, False)
        if f_flag and len(fin_selected_rb) >= max_financial: 
            continue
        fixed_hold_ids.append(stock)
        if f_flag: 
            fin_selected_rb.append(stock)
        if len(fixed_hold_ids) >= max_holdings: 
            break

# =============================================================================
# 🎯 因子今日狀態百分位 (精準脫水排除 NaN 分母版)
# =============================================================================
r_dy_today = dy_score.loc[latest_dt].dropna().rank(pct=True)
r_std_today = std_score.loc[latest_dt].dropna().rank(pct=True)

# 歷史 7 天前對比 (完全拿原始無 NaN 的 score_raw_today 做對比基準)
compare_dt = get_compare_dt(score_raw_today.index, latest_dt, days=7)
prev_current_holdings_rank_map = {}
prev_filtered_rank_map = {}
prev_market_rank_map = {}

if compare_dt is not None:
    df_h_prev = pd.DataFrame({"score": score_raw_today.loc[compare_dt].reindex(fixed_hold_ids)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
    
    filtered_ids_prev = final_cond.loc[compare_dt][final_cond.loc[compare_dt]].index
    df_f_prev = pd.DataFrame({"score": score_raw_today.loc[compare_dt].reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
    
    df_m_prev = pd.DataFrame({"score": score_raw_today.loc[compare_dt]})
    df_m_prev = df_m_prev[df_m_prev["score"] > 0]
    prev_market_rank_map = build_rank_map(df_m_prev)

# ====================== 三頁排名資料對齊生成 ======================

# --- 1. 目前持股排名 ---
df_h = pd.DataFrame({
    "score": score_raw_today.loc[latest_dt].reindex(fixed_hold_ids),
    "close": price.loc[latest_dt].reindex(fixed_hold_ids),
    "dy_rank": r_dy_today.reindex(fixed_hold_ids),
    "std_rank": r_std_today.reindex(fixed_hold_ids),
    "passed_filter": final_cond.loc[latest_dt].reindex(fixed_hold_ids).fillna(False)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"]) for sid, row in df_h.iterrows()]

# --- 2. 條件篩選排名 (僅限今日通過 final_cond 的股票) ---
filtered_ids = final_cond.loc[latest_dt][final_cond.loc[latest_dt]].index
df_f = pd.DataFrame({
    "score": score_raw_today.loc[latest_dt].reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "dy_rank": r_dy_today.reindex(filtered_ids),
    "std_rank": r_std_today.reindex(filtered_ids),
    "passed_filter": True
})
df_f = df_f.dropna(subset=["score"])
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_filtered_rank_map, False, True) for sid, row in df_f.iterrows()]

# --- 3. 全市場排名 (全量，不限制) ---
df_m = pd.DataFrame({
    "score": score_raw_today.loc[latest_dt],
    "close": price.loc[latest_dt],
    "dy_rank": r_dy_today,
    "std_rank": r_std_today,
    "passed_filter": final_cond.loc[latest_dt]
})
df_m = df_m[df_m["score"] > 0].copy()
df_m = df_m.sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"])) for sid, row in df_m.iterrows()]

current_holdings_rank = add_history_to_items(current_holdings_rank)
filtered_rank = add_history_to_items(filtered_rank)
market_rank = add_history_to_items(market_rank)

# =============================================================================
# 九、計算 Overview 績效指標
# =============================================================================
print("🚀 開始計算首頁進階指標...")
daily_return = report_x.creturn.pct_change().fillna(0)

def calc_performance(ret_series, start_date=None):
    if start_date:
        ret_series = ret_series.loc[start_date:]
    if len(ret_series) == 0:
        return {"total_return": 0.0, "annual_return": 0.0, "max_drawdown": 0.0, "sharpe_ratio": 0.0}
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
    "total_return_3y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-3))["total_return"],
    "total_return_5y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-5))["total_return"],
    "max_drawdown": calc_performance(daily_return)["max_drawdown"],
    "sharpe_ratio": calc_performance(daily_return)["sharpe_ratio"],
    "current_holdings": int(max_holdings)
}

# =============================================================================
# 十、產生 chart_data_2.json + 同步今年報酬
# =============================================================================
print("🚀 開始產生 chart_data_2.json...")

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
    
    combined = []
    for d in target.index:
        combined.append({
            "date": d.strftime('%Y-%m-%d'),
            "returns": round(float(norm.loc[d]), 2),
            "benchmark": round(float(norm_bench.loc[d]), 2)
        })
    return combined

now = datetime.now(ZoneInfo("Asia/Taipei"))

chart_json = {
    "今年": get_pts(report_x.creturn, report_x.benchmark, f"{now.year}-01-01"),
    "1年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=365)),
    "5年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=5*365)),
    "全部": get_pts(report_x.creturn, report_x.benchmark, report_x.creturn.index.min())
}

if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    latest_ytd = chart_json["今年"][-1]["returns"]
    overview["total_return_ytd"] = round(float(latest_ytd), 2)
    print(f"✅ 已同步今年報酬率: +{latest_ytd}%")

# ====================== 最終 JSON 輸出 ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(real_rebalance_dt.date()),
    "overview": overview,
    "current_holdings_rank": current_holdings_rank,
    "filtered_rank": filtered_rank,
    "market_rank": market_rank,
    "strategy_name": "高息低波"
}

public_path = Path("public")
public_path.mkdir(parents=True, exist_ok=True)

with open(public_path / "result_2.json", 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)

with open(public_path / "chart_data_2.json", 'w', encoding='utf-8') as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

print(f"============== ✅ 高息低波 脫水 100% 正確版部署完成 ==============")
