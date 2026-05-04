# scripts/generate_and_push.py
import os
import finlab
import pandas as pd
import numpy as np
import json
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

from finlab import data
from finlab.backtest import sim

print("🚀 GitHub Actions 一鍵更新開始...")

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")
else:
    print("⚠️ 未設定 FINLAB_TOKEN")

from finlab import data

# =============================================================================
# 一、資料抓取與基礎指標計算
# =============================================================================
print("📡 抓取 FinLab 資料...")

price = data.get('price:收盤價').loc['2006':'2026']
open_p = data.get('price:開盤價').loc['2006':'2026']
pe = data.get('price_earning_ratio:本益比').loc['2006':'2026']
rev_m = data.get('monthly_revenue:當月營收').loc['2006':'2026']
vol = data.get('price:成交金額').loc['2006':'2026']
mkt_p = price['0050']

for df in [price, open_p, pe, rev_m, vol]:
    df.columns = df.columns.astype(str)

ma20 = price.rolling(20).mean()
ma60 = price.rolling(60).mean()
ma120 = price.rolling(120).mean()
mkt_30 = mkt_p.rolling(30).mean()
mkt_60 = mkt_p.rolling(60).mean()

is_bear = mkt_30 < mkt_60
c_ma_filter = (ma20 > ma60) & (ma60 > ma120)

rev_ma3 = rev_m.rolling(3).mean()
rev_g = (rev_m / rev_m.shift(12)) - 1
growth_pct = (rev_g * 100).replace(0, np.nan)
peg = pe / growth_pct

c_rev_positive = rev_ma3 > 0
c_peg_range = (peg > 0.2) & (peg < 1.8)
c_rev_high = rev_ma3 == rev_ma3.rolling(12).max()
c_hist = rev_m.notnull().rolling(13).min() == 1
c_valid = peg.notnull() & rev_g.notnull()
c_liq = vol.rolling(20).min() > 1e6

final_cond = (c_rev_positive & c_peg_range & c_rev_high & c_hist & 
              c_valid & c_ma_filter & c_liq).fillna(False)

rs_fixed = price.ffill().pct_change(80, fill_method=None)
rets = price.pct_change(fill_method=None)
mkt_rets = mkt_p.pct_change(fill_method=None)
dd = rets.where(rets < 0, 0).rolling(20).std().replace(0, np.nan)
corr_mkt = rets.rolling(60).corr(mkt_rets)

r_rs = rs_fixed.where(final_cond).rank(axis=1, pct=True)
r_peg = (1 / peg).where(final_cond).rank(axis=1, pct=True)
r_dd = (-dd).where(final_cond).rank(axis=1, pct=True)
c_corr = final_cond & (corr_mkt < 0.5)
r_corr = (-corr_mkt).where(c_corr).rank(axis=1, pct=True)

is_bear_mask = is_bear.reindex(r_rs.index).ffill().fillna(True)
regime = pd.Series(np.where(is_bear_mask, 'bear', 'bull'), index=r_rs.index)

weights = pd.DataFrame({
    'rs': {'bull': 0.3, 'bear': 0.3},
    'peg': {'bull': 0.3, 'bear': 0.0},
    'corr': {'bull': 0.0, 'bear': 0.3},
    'dd': {'bull': 0.4, 'bear': 0.4},
})

w_rs_dyn = regime.map(weights['rs'])
w_peg_dyn = regime.map(weights['peg'])
w_corr_dyn = regime.map(weights['corr'])
w_dd_dyn = regime.map(weights['dd'])

score = (r_rs.mul(w_rs_dyn, axis=0).fillna(0) + 
         r_peg.mul(w_peg_dyn, axis=0).fillna(0) + 
         r_corr.mul(w_corr_dyn, axis=0).fillna(0) + 
         r_dd.mul(w_dd_dyn, axis=0).fillna(0))

r_rs_all = rs_fixed.rank(axis=1, pct=True)
r_peg_all = (1 / peg).rank(axis=1, pct=True)
r_dd_all = (-dd).rank(axis=1, pct=True)
r_corr_all = (-corr_mkt).rank(axis=1, pct=True)

full_score_matrix = (r_rs_all.mul(w_rs_dyn, axis=0).fillna(0) + 
                     r_peg_all.mul(w_peg_dyn, axis=0).fillna(0) + 
                     r_corr_all.mul(w_corr_dyn, axis=0).fillna(0) + 
                     r_dd_all.mul(w_dd_dyn, axis=0).fillna(0))

# =============================================================================
# JSON 產生部分（排名）
# =============================================================================
print("🔄 產生最新排名...")

valid_dates = score.index.intersection(peg.index).intersection(dd.index)\
                       .intersection(rs_fixed.index).intersection(price.index)
latest_dt = valid_dates.max()
print(f"✅ 使用最新資料日期: {latest_dt.date()}")

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
fixed_hold_ids = score.loc[real_rebalance_dt].sort_values(ascending=False).head(16).index

company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]
# 共用函數
def score_to_display(val):
    if pd.isna(val): return 0.0
    return round(float(60 + (val - 0.3) / 0.7 * 40), 2)

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
    if not get_cond_value(c_rev_positive, dt, sid): fail.append("營收為負")
    peg_series = peg.loc[:dt, sid].dropna()
    if len(peg_series) > 0:
        last_peg = peg_series.iloc[-1]
        if last_peg >= 1.8: fail.append("PEG過高")
        elif last_peg <= 0.2: fail.append("PEG過低")
    if not get_cond_value(c_rev_high, dt, sid): fail.append("季均營收未創高")
    if not get_cond_value(c_hist, dt, sid): fail.append("歷史資料不足")
    if not get_cond_value(c_valid, dt, sid): fail.append("估值或成長資料無效")
    if not get_cond_value(c_ma_filter, dt, sid): fail.append("均線非多頭排列")
    if not get_cond_value(c_liq, dt, sid): fail.append("流動性不足")
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

# ====================== 產生排名 ======================
# 今日分數
r_rs_today = rs_fixed.loc[latest_dt].rank(pct=True)
r_peg_today = (1 / peg).loc[latest_dt].rank(pct=True)
r_dd_today = (-dd).loc[latest_dt].rank(pct=True)
r_corr_today = (-corr_mkt).loc[latest_dt].rank(pct=True)

curr_regime = regime.loc[latest_dt]
w = weights.apply(lambda x: x[curr_regime])
score_raw_today = r_rs_today * w["rs"] + r_peg_today * w["peg"] + r_corr_today * w["corr"] + r_dd_today * w["dd"]

# 上週比較
compare_dt = get_compare_dt(score.index, latest_dt, days=7)
prev_current_holdings_rank_map = prev_filtered_rank_map = prev_market_rank_map = {}

if compare_dt is not None and compare_dt in valid_dates:
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

# 產生三種排名（完整）
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
# 共用函數
def score_to_display(val):
    if pd.isna(val): return 0.0
    return round(float(60 + (val - 0.3) / 0.7 * 40), 2)

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
    if not get_cond_value(c_rev_positive, dt, sid): fail.append("營收為負")
    peg_series = peg.loc[:dt, sid].dropna()
    if len(peg_series) > 0:
        last_peg = peg_series.iloc[-1]
        if last_peg >= 1.8: fail.append("PEG過高")
        elif last_peg <= 0.2: fail.append("PEG過低")
    if not get_cond_value(c_rev_high, dt, sid): fail.append("季均營收未創高")
    if not get_cond_value(c_hist, dt, sid): fail.append("歷史資料不足")
    if not get_cond_value(c_valid, dt, sid): fail.append("估值或成長資料無效")
    if not get_cond_value(c_ma_filter, dt, sid): fail.append("均線非多頭排列")
    if not get_cond_value(c_liq, dt, sid): fail.append("流動性不足")
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

# ====================== 產生排名 ======================
# 今日分數
r_rs_today = rs_fixed.loc[latest_dt].rank(pct=True)
r_peg_today = (1 / peg).loc[latest_dt].rank(pct=True)
r_dd_today = (-dd).loc[latest_dt].rank(pct=True)
r_corr_today = (-corr_mkt).loc[latest_dt].rank(pct=True)

curr_regime = regime.loc[latest_dt]
w = weights.apply(lambda x: x[curr_regime])
score_raw_today = r_rs_today * w["rs"] + r_peg_today * w["peg"] + r_corr_today * w["corr"] + r_dd_today * w["dd"]

# 上週比較
compare_dt = get_compare_dt(score.index, latest_dt, days=7)
prev_current_holdings_rank_map = prev_filtered_rank_map = prev_market_rank_map = {}

if compare_dt is not None and compare_dt in valid_dates:
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

# 產生三種排名（完整）
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
# 共用函數
def score_to_display(val):
    if pd.isna(val): return 0.0
    return round(float(60 + (val - 0.3) / 0.7 * 40), 2)

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
    if not get_cond_value(c_rev_positive, dt, sid): fail.append("營收為負")
    peg_series = peg.loc[:dt, sid].dropna()
    if len(peg_series) > 0:
        last_peg = peg_series.iloc[-1]
        if last_peg >= 1.8: fail.append("PEG過高")
        elif last_peg <= 0.2: fail.append("PEG過低")
    if not get_cond_value(c_rev_high, dt, sid): fail.append("季均營收未創高")
    if not get_cond_value(c_hist, dt, sid): fail.append("歷史資料不足")
    if not get_cond_value(c_valid, dt, sid): fail.append("估值或成長資料無效")
    if not get_cond_value(c_ma_filter, dt, sid): fail.append("均線非多頭排列")
    if not get_cond_value(c_liq, dt, sid): fail.append("流動性不足")
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

# ====================== 產生排名 ======================
# 今日分數
r_rs_today = rs_fixed.loc[latest_dt].rank(pct=True)
r_peg_today = (1 / peg).loc[latest_dt].rank(pct=True)
r_dd_today = (-dd).loc[latest_dt].rank(pct=True)
r_corr_today = (-corr_mkt).loc[latest_dt].rank(pct=True)

curr_regime = regime.loc[latest_dt]
w = weights.apply(lambda x: x[curr_regime])
score_raw_today = r_rs_today * w["rs"] + r_peg_today * w["peg"] + r_corr_today * w["corr"] + r_dd_today * w["dd"]

# 上週比較
compare_dt = get_compare_dt(score.index, latest_dt, days=7)
prev_current_holdings_rank_map = prev_filtered_rank_map = prev_market_rank_map = {}

if compare_dt is not None and compare_dt in valid_dates:
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

# 產生三種排名（完整）
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
# ====================== 完整策略回測 ======================
print("🚀 產生 position_final 與執行真實回測...")

N_BULL = 16
N_BEAR = 5

score_ranks = score.rank(axis=1, ascending=False)

bull_mask = score_ranks <= N_BULL
bear_mask = score_ranks <= N_BEAR

weight_bull = bull_mask.div(bull_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
weight_bear = bear_mask.div(bear_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)

raw_position = weight_bull.where(~is_bear_mask, weight_bear).fillna(0)

# T+1 漲停買不到處理
limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)
cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

target_pos_qe = raw_position.resample('QE').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
position_final = raw_position.copy()
blocked_buy = buy_order & cannot_buy_t1
position_final[blocked_buy] = prev_position[blocked_buy]

position_final = position_final.reindex(index=price.index, columns=price.columns).fillna(0)

# 執行回測
report = sim(
    position_final.loc['2010':'2026'],
    resample='QE',
    trade_at_price='open',
    fee_ratio=0.001425,
    tax_ratio=0.003,
    position_limit=0.2,
    market='TW_STOCK',
    name='動態多因子策略',
)

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
    rolling_max = cum.cummax()
    drawdown = (cum - rolling_max) / rolling_max
    max_dd = drawdown.min() * 100
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

print("✅ 指標計算完成")

# ====================== 最終 result_json ======================
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

output_path = Path("public/result.json")
output_path.parent.mkdir(parents=True, exist_ok=True)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)

print(f"✅ result.json 已更新 ({output_path.stat().st_size / 1024:.1f} KB)")
print(f"最新日期: {result_json['latest_date']}")
print(f"更新時間: {result_json['updated_at']}")
