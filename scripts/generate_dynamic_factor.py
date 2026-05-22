# scripts/generate_and_push.py
import os
import finlab
import pandas as pd
import json
import numpy as np
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

from finlab import data
from shared_backtest import run_full_backtest

print("🚀 GitHub Actions 一鍵更新開始...")

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")
else:
    print("⚠️ 未設定 FINLAB_TOKEN")

# =============================================================================
# 1. 執行完整回測（共用）
# ===========================================================================
report, position_final, price, score, final_cond, rs_fixed, peg, dd, corr_mkt, regime, weights, full_score_matrix, \
c_rev_positive, c_rev_high, c_hist, c_ma_filter, c_liq = run_full_backtest()
# =============================================================================
# 2. 產生排名資料
# =============================================================================
# 找到最後一個所有必要資料都存在的日期
valid_dates = score.index.intersection(rs_fixed.index)\
                        .intersection(peg.index)\
                        .intersection(dd.index)\
                        .intersection(corr_mkt.index)

latest_dt = valid_dates.max()

print(f"✅ 使用最新完整資料日期: {latest_dt.date()}")

# 季度基準日
curr_year, curr_month = latest_dt.year, latest_dt.month
if 4 <= curr_month < 7:
    rebalance_date_str = f"{curr_year}-03-31"
elif 7 <= curr_month < 10:
    rebalance_date_str = f"{curr_year}-06-30"
elif curr_month >= 10:
    rebalance_date_str = f"{curr_year}-09-30"
else:
    rebalance_date_str = f"{curr_year}-12-31"

real_rebalance_dt = score.index[score.index >= pd.to_datetime(rebalance_date_str)].min()

# ====================== 公司資訊 ======================
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# ====================== 共用函數 ======================
def score_to_display(val):
    if pd.isna(val): return 0.0
    mapped_score = 60 + (float(val) - 0.5) / 0.4 * 40
    # 限制最高 100 分，不設下限以反映真實數據
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

def get_rank_change_info(stock_id, prev_rank_map, current_rank):
    sid = str(stock_id)
    prev_rank = prev_rank_map.get(sid)
    if prev_rank is None:
        return None, None, "new"
    rank_change = int(prev_rank - current_rank)
    change_type = "up" if rank_change > 0 else "down" if rank_change < 0 else "flat"
    return int(prev_rank), rank_change, change_type

def get_cond_value(cond_df, dt, sid):
    sid = str(sid)
    if sid not in cond_df.columns: return False
    s = cond_df[sid].loc[:dt]
    if len(s) == 0: return False
    return bool(s.iloc[-1])

def get_failed_conditions(sid, dt):
    fail = []
    
    # 1. 營收相關檢查
    if not get_cond_value(c_rev_positive, dt, sid):
        fail.append("當季營收為負或零")
    
    if not get_cond_value(c_rev_high, dt, sid):
        fail.append("季均營收未創新高")
    
    if not get_cond_value(c_hist, dt, sid):
        fail.append("營收資料不足（少於13個月）")
    
    # 2. PEG 檢查
    if sid in peg.columns:
        peg_value = peg.loc[dt, sid]
        if pd.notna(peg_value):
            if peg_value <= 0.2:
                fail.append("PEG過低")
            elif peg_value >= 1.8:
                fail.append("PEG過高")
    
    # 3. 其他重要濾網
    if not get_cond_value(c_ma_filter, dt, sid):
        fail.append("均線未呈多頭排列")
    
    if not get_cond_value(c_liq, dt, sid):
        fail.append("流動性不足（成交金額太低）")
    
    # 4. 如果 final_cond 整體失敗，但上面沒抓到，給一個兜底原因
    if not get_cond_value(final_cond, dt, sid) and not fail:
        fail.append("未通過綜合濾網")
    
    return fail

def build_stock_item(sid, row, base_rank, prev_rank_map, selected=None, passed_filter=None):
    prev_rank, rank_change, change_type = get_rank_change_info(sid, prev_rank_map, int(base_rank))
    item = {
        "base_rank": int(base_rank),
        "prev_rank": prev_rank,
        "rank_change": rank_change,
        "change_type": change_type,
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(sid, "")),
        "full_name": str(company_full_name_map.get(sid, "")),
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "rs_pct": pct_win(row.get("rs_pct")),
        "peg_pct": pct_win(row.get("peg_pct")),
        "dd_pct": pct_win(row.get("dd_pct")),
        "corr_pct": pct_win(row.get("corr_pct")),
    }
    if selected is not None: item["selected"] = bool(selected)
    if passed_filter is not None:
        item["passed_filter"] = bool(passed_filter)
        item["failed_conditions"] = [] if bool(passed_filter) else get_failed_conditions(sid, latest_dt)
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
fixed_hold_ids = score.loc[real_rebalance_dt].sort_values(ascending=False).head(16).index

r_rs_today = rs_fixed.loc[latest_dt].rank(pct=True)
r_peg_today = (1 / peg).loc[latest_dt].rank(pct=True)
r_dd_today = (-dd).loc[latest_dt].rank(pct=True)
r_corr_today = (-corr_mkt).loc[latest_dt].rank(pct=True)

curr_regime = regime.loc[latest_dt]
w = weights.apply(lambda x: x[curr_regime])
score_raw_today = r_rs_today * w["rs"] + r_peg_today * w["peg"] + r_corr_today * w["corr"] + r_dd_today * w["dd"]

compare_dt = get_compare_dt(valid_dates, latest_dt, days=7)
prev_current_holdings_rank_map = {}
prev_filtered_rank_map = {}
prev_market_rank_map = {}
if compare_dt is not None:
    # 使用你原本的比較邏輯（只補這部分）
    r_rs_prev = rs_fixed.loc[compare_dt].rank(pct=True)
    r_peg_prev = (1 / peg).loc[compare_dt].rank(pct=True)
    r_dd_prev = (-dd).loc[compare_dt].rank(pct=True)
    r_corr_prev = (-corr_mkt).loc[compare_dt].rank(pct=True)
    
    prev_regime = regime.loc[compare_dt]
    w_prev = weights.apply(lambda x: x[prev_regime])
    score_raw_prev = r_rs_prev * w_prev["rs"] + r_peg_prev * w_prev["peg"] + r_corr_prev * w_prev["corr"] + r_dd_prev * w_prev["dd"]
    
    df_h_prev = pd.DataFrame({"score": score_raw_prev.reindex(fixed_hold_ids)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
    
    filtered_ids_prev = final_cond.loc[compare_dt][final_cond.loc[compare_dt]].index
    df_f_prev = pd.DataFrame({"score": score_raw_prev.reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
    
    df_m_prev = pd.DataFrame({"score": score_raw_prev})
    df_m_prev = df_m_prev[df_m_prev["score"] > 0]
    prev_market_rank_map = build_rank_map(df_m_prev)

# ====================== 目前持股排名 ======================
df_h = pd.DataFrame({
    "score": score_raw_today.reindex(fixed_hold_ids),
    "close": price.loc[latest_dt].reindex(fixed_hold_ids),
    "rs_pct": r_rs_today.reindex(fixed_hold_ids),
    "peg_pct": r_peg_today.reindex(fixed_hold_ids),
    "dd_pct": r_dd_today.reindex(fixed_hold_ids),
    "corr_pct": r_corr_today.reindex(fixed_hold_ids),
    "passed_filter": final_cond.loc[latest_dt].reindex(fixed_hold_ids)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"]) for sid, row in df_h.iterrows()]

# ====================== 條件篩選排名（全量，不限制） ======================
filtered_ids = final_cond.loc[latest_dt][final_cond.loc[latest_dt]].index
df_f = pd.DataFrame({
    "score": score_raw_today.reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "rs_pct": r_rs_today.reindex(filtered_ids),
    "peg_pct": r_peg_today.reindex(filtered_ids),
    "dd_pct": r_dd_today.reindex(filtered_ids),
    "corr_pct": r_corr_today.reindex(filtered_ids),
    "passed_filter": True
})
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item(sid, row, row["base_rank"], prev_filtered_rank_map, False, True) for sid, row in df_f.iterrows()]

# ====================== 全市場排名（全量，不限制） ======================
df_m = pd.DataFrame({
    "score": score_raw_today,
    "close": price.loc[latest_dt],
    "rs_pct": r_rs_today,
    "peg_pct": r_peg_today,
    "dd_pct": r_dd_today,
    "corr_pct": r_corr_today,
    "passed_filter": final_cond.loc[latest_dt]
})
df_m = df_m[df_m["score"] > 0].copy()
df_m = df_m.sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [build_stock_item(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"])) for sid, row in df_m.iterrows()]

current_holdings_rank = add_history_to_items(current_holdings_rank)
filtered_rank = add_history_to_items(filtered_rank)
market_rank = add_history_to_items(market_rank)

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
    "total_return_3y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-3))["total_return"],
    "total_return_5y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-5))["total_return"],
    "max_drawdown": calc_performance(daily_return)["max_drawdown"],
    "sharpe_ratio": calc_performance(daily_return)["sharpe_ratio"],
    "current_holdings": 16
}

# =============================================================================
# 3. 產生 chart_data.json + 同步今年報酬
# =============================================================================
print("🚀 開始產生 chart_data.json...")

def get_pts(series, benchmark_series, start_dt, period=None):
    """支援周切片：5年與全部改成每周資料，徹底解決首頁 lag"""
    if isinstance(start_dt, str):
        start_dt = pd.to_datetime(start_dt)
    else:
        start_dt = pd.to_datetime(start_dt).tz_localize(None)
   
    mask = series.index >= start_dt
    target = series[mask]
    target_bench = benchmark_series.reindex(target.index).ffill()
   
    if len(target) == 0:
        return []
   
    # === 關鍵修正：長週期改成周切片 ===
    if period in ['5年', '全部']:
        target = target.resample('W-FRI').last().dropna()           # 每周五
        target_bench = target_bench.resample('W-FRI').last().dropna()
    # 今年 / 1年 保持日頻（資料量小，保留細節）

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
    "今年": get_pts(report.creturn, report.benchmark, f"{now.year}-01-01", period="今年"),
    "1年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=365), period="1年"),
    "5年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=5*365), period="5年"),
    "全部": get_pts(report.creturn, report.benchmark, report.creturn.index.min(), period="全部")
}

# === 關鍵同步：覆蓋 result_json 中的今年報酬 ===
if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    latest_ytd = chart_json["今年"][-1]["returns"]
    overview["total_return_ytd"] = round(float(latest_ytd), 2)
    print(f"✅ 已同步今年報酬率: +{latest_ytd}%")
else:
    print("⚠️ 無法同步今年報酬率")

# ====================== 最終輸出 ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(real_rebalance_dt.date()),
    "overview": overview,
    "current_holdings_rank": current_holdings_rank,
    "filtered_rank": filtered_rank,
    "market_rank": market_rank
}

# 寫入兩個 json
output_path = Path("public/result.json")
output_path.parent.mkdir(parents=True, exist_ok=True)
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)

chart_path = Path("public/chart_data.json")
with open(chart_path, 'w', encoding='utf-8') as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

print(f"✅ result.json & chart_data.json 已更新")
print(f"今年報酬最終值: +{overview['total_return_ytd']}%")

