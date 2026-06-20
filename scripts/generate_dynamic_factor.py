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
from finlab.backtest import sim
import twstock   # 新增：用來取得股票「上市 / 上櫃」標籤
print("🚀 GitHub Actions 一鍵更新開始...")

# =============================================================================
# 完整回測邏輯（原 shared_backtest.py 完整合併進來）
# =============================================================================
def run_full_backtest():
    print("🚀 執行完整回測 (shared_backtest.py)...")
    # =============================================================================
    # 一、資料抓取與基礎指標計算
    # =============================================================================
    price = data.get('price:收盤價').loc['2006':'2026']
    open_p = data.get('price:開盤價').loc['2006':'2026']
    pe = data.get('price_earning_ratio:本益比').loc['2006':'2026']
    rev_m = data.get('monthly_revenue:當月營收').loc['2006':'2026']
    vol = data.get('price:成交金額').loc['2006':'2026']
    mkt_p = price['0050']
    for df in [price, open_p, pe, rev_m, vol]:
        df.columns = df.columns.astype(str)
    # 均線
    ma20 = price.rolling(20).mean()
    ma60 = price.rolling(60).mean()
    ma120 = price.rolling(120).mean()
    mkt_30 = mkt_p.rolling(30).mean()
    mkt_60 = mkt_p.rolling(60).mean()
    # =============================================================================
    # 二、大盤狀態與均線濾網
    # =============================================================================
    is_bear = mkt_30 < mkt_60
    c_ma_filter = (ma20 > ma60) & (ma60 > ma120)
    # =============================================================================
    # 三、選股過濾條件（已移除 corr < 0.5 濾網）
    # =============================================================================
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
    final_cond = (
        c_rev_positive & c_peg_range & c_rev_high &
        c_hist & c_valid & c_ma_filter & c_liq
    ).fillna(False)
    # =============================================================================
    # 四、多因子評分系統
    # =============================================================================
    rs_fixed = price.ffill().pct_change(80, fill_method=None)
    rets = price.pct_change(fill_method=None)
    mkt_rets = mkt_p.pct_change(fill_method=None)
    dd = rets.where(rets < 0, 0).rolling(20).std().replace(0, np.nan)
    corr_mkt = rets.rolling(60).corr(mkt_rets)
    r_rs = rs_fixed.where(final_cond).rank(axis=1, pct=True)
    r_peg = (1 / peg).where(final_cond).rank(axis=1, pct=True)
    r_dd = (-dd).where(final_cond).rank(axis=1, pct=True)
    r_corr = (-corr_mkt).where(final_cond).rank(axis=1, pct=True)  # 移除 corr < 0.5 濾網
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
    score = (
        r_rs.mul(w_rs_dyn, axis=0).fillna(0) +
        r_peg.mul(w_peg_dyn, axis=0).fillna(0) +
        r_corr.mul(w_corr_dyn, axis=0).fillna(0) +
        r_dd.mul(w_dd_dyn, axis=0).fillna(0)
    )
    # full_score_matrix（歷史分數用）
    r_rs_all = rs_fixed.rank(axis=1, pct=True)
    r_peg_all = (1 / peg).rank(axis=1, pct=True)
    r_dd_all = (-dd).rank(axis=1, pct=True)
    r_corr_all = (-corr_mkt).rank(axis=1, pct=True)
    full_score_matrix = (
        r_rs_all.mul(w_rs_dyn, axis=0).fillna(0) +
        r_peg_all.mul(w_peg_dyn, axis=0).fillna(0) +
        r_corr_all.mul(w_corr_dyn, axis=0).fillna(0) +
        r_dd_all.mul(w_dd_dyn, axis=0).fillna(0)
    )
    # =============================================================================
    # 五、持股權重 + T+1 處理
    # =============================================================================
    N_BULL, N_BEAR = 16, 5
    score_ranks = score.rank(axis=1, ascending=False)
    bull_mask = score_ranks <= N_BULL
    bear_mask = score_ranks <= N_BEAR
    weight_bull = bull_mask.div(bull_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
    weight_bear = bear_mask.div(bear_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
    raw_position = weight_bull.where(~is_bear_mask, weight_bear).fillna(0)
    # T+1 處理
    limit_pct = pd.Series(0.095, index=price.index)
    limit_pct.loc[:'2015-05-31'] = 0.065
    limit_up_price_next = price.mul(1 + limit_pct, axis=0)
    cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next
    prev_position = raw_position.shift(1).fillna(0)
    buy_order = raw_position > prev_position
    blocked_buy = buy_order & cannot_buy_t1
    position_final = raw_position.copy()
    position_final[blocked_buy] = prev_position[blocked_buy]
    position_final = position_final.reindex(index=price.index, columns=price.columns).fillna(0)
    # =============================================================================
    # 六、執行回測
    # =============================================================================
    report = sim(
        position_final.loc['2010':'2026'],
        resample='QE',
        trade_at_price='open',
        fee_ratio=0.001425,
        tax_ratio=0.003,
        position_limit=0.2,
        market='TW_STOCK',
        name='動態多因子策略'
    )
    if not hasattr(report, 'benchmark') or report.benchmark is None:
        benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
        report.benchmark = benchmark.reindex(report.creturn.index).ffill()
    print("✅ 完整回測執行完成！")
    return (
        report, position_final, price, score, final_cond,
        rs_fixed, peg, dd, corr_mkt, regime, weights, full_score_matrix,
        c_rev_positive, c_rev_high, c_hist, c_ma_filter, c_liq
    )

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")

# =============================================================================
# 1. 執行完整回測
# =============================================================================
report, position_final, price, score, final_cond, rs_fixed, peg, dd, corr_mkt, regime, weights, full_score_matrix, \
c_rev_positive, c_rev_high, c_hist, c_ma_filter, c_liq = run_full_backtest()

# =============================================================================
# 2. 產生排名資料
# =============================================================================
valid_dates = score.index.intersection(rs_fixed.index).intersection(peg.index).intersection(dd.index).intersection(corr_mkt.index)
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

# 1. 取得完整交易日曆
trading_days = data.get('price:收盤價').index

# 2. 定義本次基準日 (T)
base_date = pd.to_datetime(real_rebalance_dt)

# 3. 計算本次換倉執行日 (T+1)
idx = trading_days.searchsorted(base_date)
if idx < len(trading_days) and trading_days[idx] == base_date:
    idx += 1
execution_dt = trading_days[idx] if idx < len(trading_days) else trading_days[-1]

# 4. 【精準修正】計算下次預計換倉日
# 邏輯：直接抓下個季度的「季末日」，然後由 trading_days 告訴我們「下一個開盤日」是哪天
next_quarter_end = base_date + pd.offsets.QuarterEnd(1)

# 使用 searchsorted 尋找 next_quarter_end 的位置
next_idx = trading_days.searchsorted(next_quarter_end)

# --- 核心邏輯 ---
# 1. 如果搜尋到的位置 < 交易日曆長度
if next_idx < len(trading_days):
    # 如果搜尋到的當天就是季末日 (例如 6/30)，強制 +1 指向 7/1
    # 如果搜尋到的當天不是季末日 (代表 6/30 是假日)，searchsorted 自動指向 7/1，此時不做額外 +1
    if trading_days[next_idx] == next_quarter_end:
        next_idx += 1
    
    # 再次檢查越界
    if next_idx < len(trading_days):
        next_rebalance_dt = trading_days[next_idx]
    else:
        next_rebalance_dt = trading_days[-1]
else:
    # 資料庫還沒到那麼遠 (Fallback)
    # 此處我們只需數學推算到季末日隔天，並避開六日
    next_rebalance_dt = next_quarter_end + pd.Timedelta(days=1)
    while next_rebalance_dt.dayofweek >= 5:
        next_rebalance_dt += pd.Timedelta(days=1)

print(f"DEBUG: 基準日 {base_date.date()} -> 換倉執行日 {execution_dt.date()} -> 下次預計 {next_rebalance_dt.date()}")

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
    if not get_cond_value(c_rev_positive, dt, sid):
        fail.append("當季營收為負或零")
    if not get_cond_value(c_rev_high, dt, sid):
        fail.append("季均營收未創新高")
    if not get_cond_value(c_hist, dt, sid):
        fail.append("營收資料不足（少於13個月）")
    if sid in peg.columns:
        peg_value = peg.loc[dt, sid]
        if pd.notna(peg_value):
            if peg_value <= 0.2:
                fail.append("PEG過低")
            elif peg_value >= 1.8:
                fail.append("PEG過高")
        else:
            fail.append("PEG資料缺失")
    if not get_cond_value(c_ma_filter, dt, sid):
        fail.append("均線未呈多頭排列")
    if not get_cond_value(c_liq, dt, sid):
        fail.append("流動性不足（成交金額太低）")
    if not get_cond_value(final_cond, dt, sid) and not fail:
        fail.append("未通過綜合濾網")
    return fail


# ====================== 新增：上市上櫃標籤 helper（只顯示用，極簡版） ======================
def get_market_type(stock_id):
    """從 twstock 取得該股票的市場別（上市 / 上櫃）"""
    try:
        info = twstock.codes.get(str(stock_id))
        if info and hasattr(info, 'market'):
            return info.market  # 會回傳 '上市' 或 '上櫃'
    except Exception:
        pass
    return '未知'


def build_stock_item(sid, row, base_rank, prev_rank_map, selected=None, passed_filter=None):
    prev_rank, rank_change, change_type = get_rank_change_info(sid, prev_rank_map, int(base_rank))
    short_name = str(company_short_name_map.get(sid, "")).strip()
    full_name = str(company_full_name_map.get(sid, "")).strip()
    name = short_name if short_name else full_name
    if not name or name == str(sid):
        return None
    item = {
        "base_rank": int(base_rank),
        "prev_rank": prev_rank,
        "rank_change": rank_change,
        "change_type": change_type,
        "stock_id": str(sid),
        "name": name,
        "full_name": full_name if full_name else name,
        "market": get_market_type(sid),   # 新增：上市 / 上櫃 標籤（只顯示用）
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

# ====================== 產生三種排名（牛市版本 → result.json）======================
fixed_hold_ids = score.loc[real_rebalance_dt].sort_values(ascending=False).head(16).index

r_rs_today = rs_fixed.loc[latest_dt].rank(pct=True)
r_peg_today = (1 / peg).loc[latest_dt].rank(pct=True).fillna(0)
r_dd_today = (-dd).loc[latest_dt].rank(pct=True)
r_corr_today = (-corr_mkt).loc[latest_dt].rank(pct=True)
curr_regime = regime.loc[latest_dt]

w = weights.apply(lambda x: x[curr_regime])

peg_series = peg.loc[latest_dt]
peg_nan_mask = peg_series.isna() | (peg_series <= 0)

w_rs_adj = pd.Series(w["rs"], index=peg_nan_mask.index)
w_peg_adj = pd.Series(w["peg"], index=peg_nan_mask.index)
w_dd_adj = pd.Series(w["dd"], index=peg_nan_mask.index)
w_corr_adj = pd.Series(w["corr"], index=peg_nan_mask.index)

if curr_regime == 'bull':
    w_rs_adj = w_rs_adj.where(~peg_nan_mask, 0.6)
    w_peg_adj = w_peg_adj.where(~peg_nan_mask, 0.0)
    w_dd_adj = w_dd_adj.where(~peg_nan_mask, 0.4)

score_raw_today = (
    r_rs_today * w_rs_adj +
    r_peg_today * w_peg_adj +
    r_corr_today * w_corr_adj +
    r_dd_today * w_dd_adj
)

# 預計算 history（最近5天）
recent_dates = valid_dates[-5:]
recent_adjusted = pd.DataFrame(index=recent_dates, columns=score_raw_today.index)
for dt in recent_dates:
    regime_dt = regime.loc[dt]
    w_dt = weights.apply(lambda x: x[regime_dt])
    peg_series_dt = peg.loc[dt]
    peg_nan_mask_dt = peg_series_dt.isna() | (peg_series_dt <= 0)
    w_rs = pd.Series(w_dt["rs"], index=peg_nan_mask_dt.index)
    w_peg = pd.Series(w_dt["peg"], index=peg_nan_mask_dt.index)
    w_dd = pd.Series(w_dt["dd"], index=peg_nan_mask_dt.index)
    w_corr = pd.Series(w_dt["corr"], index=peg_nan_mask_dt.index)
    if regime_dt == 'bull':
        w_rs = w_rs.where(~peg_nan_mask_dt, 0.6)
        w_peg = w_peg.where(~peg_nan_mask_dt, 0.0)
        w_dd = w_dd.where(~peg_nan_mask_dt, 0.4)
    r_rs_h = rs_fixed.loc[dt].rank(pct=True)
    r_peg_h = (1 / peg).loc[dt].rank(pct=True).fillna(0)
    r_dd_h = (-dd).loc[dt].rank(pct=True)
    r_corr_h = (-corr_mkt).loc[dt].rank(pct=True)
    recent_adjusted.loc[dt] = (
        r_rs_h * w_rs + r_peg_h * w_peg + r_corr_h * w_corr + r_dd_h * w_dd
    )

compare_dt = get_compare_dt(valid_dates, latest_dt, days=7)
prev_current_holdings_rank_map = prev_filtered_rank_map = prev_market_rank_map = {}

if compare_dt is not None:
    r_rs_prev = rs_fixed.loc[compare_dt].rank(pct=True)
    r_peg_prev = (1 / peg).loc[compare_dt].rank(pct=True).fillna(0)
    r_dd_prev = (-dd).loc[compare_dt].rank(pct=True)
    r_corr_prev = (-corr_mkt).loc[compare_dt].rank(pct=True)
    prev_regime = regime.loc[compare_dt]
    w_prev = weights.apply(lambda x: x[prev_regime])
    peg_series_prev = peg.loc[compare_dt]
    peg_nan_mask_prev = peg_series_prev.isna() | (peg_series_prev <= 0)
    w_rs_adj_prev = pd.Series(w_prev["rs"], index=peg_nan_mask_prev.index)
    w_peg_adj_prev = pd.Series(w_prev["peg"], index=peg_nan_mask_prev.index)
    w_dd_adj_prev = pd.Series(w_prev["dd"], index=peg_nan_mask_prev.index)
    w_corr_adj_prev = pd.Series(w_prev["corr"], index=peg_nan_mask_prev.index)
    if prev_regime == 'bull':
        w_rs_adj_prev = w_rs_adj_prev.where(\~peg_nan_mask_prev, 0.6)
        w_peg_adj_prev = w_peg_adj_prev.where(\~peg_nan_mask_prev, 0.0)
        w_dd_adj_prev = w_dd_adj_prev.where(\~peg_nan_mask_prev, 0.4)
    score_raw_prev = (
        r_rs_prev * w_rs_adj_prev +
        r_peg_prev * w_peg_adj_prev +
        r_corr_prev * w_corr_adj_prev +
        r_dd_prev * w_dd_adj_prev
    )
    df_h_prev = pd.DataFrame({"score": score_raw_prev.reindex(fixed_hold_ids)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
    filtered_ids_prev = final_cond.loc[compare_dt][final_cond.loc[compare_dt]].index
    df_f_prev = pd.DataFrame({"score": score_raw_prev.reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
    df_m_prev = pd.DataFrame({"score": score_raw_prev})
    df_m_prev = df_m_prev[df_m_prev["score"] > 0]
    prev_market_rank_map = build_rank_map(df_m_prev)

# ====================== 目前持股排名（result.json）======================
df_h = pd.DataFrame({
    "score": score_raw_today.reindex(fixed_hold_ids),
    "close": price.loc[latest_dt].reindex(fixed_hold_ids),
    "rs_pct": r_rs_today.reindex(fixed_hold_ids),
    "peg_pct": r_peg_today.reindex(fixed_hold_ids),
    "dd_pct": r_dd_today.reindex(fixed_hold_ids),
    "passed_filter": final_cond.loc[latest_dt].reindex(fixed_hold_ids)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"]) for sid, row in df_h.iterrows()]

# ====================== 條件篩選排名（result.json）======================
filtered_ids = final_cond.loc[latest_dt][final_cond.loc[latest_dt]].index
df_f = pd.DataFrame({
    "score": score_raw_today.reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "rs_pct": r_rs_today.reindex(filtered_ids),
    "peg_pct": r_peg_today.reindex(filtered_ids),
    "dd_pct": r_dd_today.reindex(filtered_ids),
    "passed_filter": True
})
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item(sid, row, row["base_rank"], prev_filtered_rank_map, False, True) for sid, row in df_f.iterrows()]

# ====================== 全市場排名（result.json）======================
df_m = pd.DataFrame({
    "score": score_raw_today,
    "close": price.loc[latest_dt].reindex(score_raw_today.index),
    "rs_pct": r_rs_today.reindex(score_raw_today.index),
    "peg_pct": r_peg_today.reindex(score_raw_today.index),
    "dd_pct": r_dd_today.reindex(score_raw_today.index),
    "passed_filter": final_cond.loc[latest_dt].reindex(score_raw_today.index).fillna(False)
})
df_m = df_m[df_m["score"] > 0].copy()
df_m = df_m.sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [item for item in [build_stock_item(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"])) for sid, row in df_m.iterrows()] if item is not None]

def add_history_to_items(items, adjusted_df=None):
    if adjusted_df is None:
        adjusted_df = recent_adjusted
    for item in items:
        sid = item["stock_id"]
        history_list = []
        count = 0
        for dt in recent_dates:
            if count >= 5: break
            val = adjusted_df.loc[dt, sid]
            display_score = score_to_display(val) if pd.notna(val) else 42.9
            history_list.append({"date": str(dt.date()), "score": round(display_score, 1)})
            count += 1
        item["history"] = history_list
    return items

current_holdings_rank = add_history_to_items(current_holdings_rank)
filtered_rank = add_history_to_items(filtered_rank)
market_rank = add_history_to_items(market_rank)

# ====================== 🛠️ 嚴謹版 filter_days 處理機制（假日與同天更新保護） ======================
PREV_RESULT_FILE = Path("public/result.json")
prev_days_map = {}
is_same_day = False
current_date_str = str(latest_dt.date())

# 1. 讀取昨日舊檔並進行同天判定
if PREV_RESULT_FILE.exists():
    try:
        prev_data = json.loads(PREV_RESULT_FILE.read_text(encoding="utf-8"))
        prev_date_str = prev_data.get("latest_date")
        if prev_date_str == current_date_str:
            is_same_day = True
            print(f"📅 偵測到今日資料日期已存在 ({current_date_str})，鎖定昨日天數不進行遞增。")
        
        # 僅提取舊檔中 filtered_rank 的留存天數
        for item in prev_data.get("filtered_rank", []):
            sid = item.get("stock_id")
            if sid and "filter_days" in item:
                prev_days_map[sid] = item["filter_days"]
    except Exception as e:
        print(f"⚠️ 讀取上一個 result.json 失敗: {e}")

# 2. 【核心修改點一】只更新牛市的 filtered_rank 天數，其餘兩個 Rank 絕不注入天數欄位
today_filtered_days_map = {}
for item in filtered_rank:
    sid = item["stock_id"]
    yesterday_days = prev_days_map.get(sid, 0)
    if is_same_day:
        item["filter_days"] = yesterday_days if yesterday_days > 0 else 1
    else:
        item["filter_days"] = yesterday_days + 1
    # 存入記憶體對照表，等等完美對齊共享給熊市
    today_filtered_days_map[sid] = item["filter_days"]

print(f"✅ 牛市篩選榜天數計算完成！")

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
    return {"total_return": round(total_ret, 2), "annual_return": round(annual_ret, 2), "max_drawdown": round(max_dd, 2), "sharpe_ratio": round(sharpe, 2)}
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
# 3. 產生 chart_data.json
# =============================================================================
print("🚀 開始產生 chart_data.json...")
def get_pts(series, benchmark_series, start_dt, period=None):
    if isinstance(start_dt, str): start_dt = pd.to_datetime(start_dt)
    else: start_dt = pd.to_datetime(start_dt).tz_localize(None)
    mask = series.index >= start_dt
    target = series[mask]
    target_bench = benchmark_series.reindex(target.index).ffill()
    if len(target) == 0: return []
    if period in ['5年', '全部']:
        target = target.resample('W-FRI').last().dropna()
        target_bench = target_bench.resample('W-FRI').last().dropna()
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

if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    latest_ytd = chart_json["今年"][-1]["returns"]
    overview["total_return_ytd"] = round(float(latest_ytd), 2)

# ====================== 最終輸出 result.json ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(execution_dt.date()),
    "next_rebalance_date": str(next_rebalance_dt.date()), # 新增下次執行日
    "overview": overview,
    "current_holdings_rank": current_holdings_rank,
    "filtered_rank": filtered_rank,
    "market_rank": market_rank
}

# ====================== 產生 result_bear.json ======================
print("🚀 開始產生 result_bear.json（純熊市權重）...")
w_bear = {'rs': 0.3, 'corr': 0.3, 'dd': 0.4, 'peg': 0.0}
score_raw_today_bear = (
    r_rs_today * w_bear['rs'] +
    r_corr_today * w_bear['corr'] +
    r_dd_today * w_bear['dd']
)

recent_adjusted_bear = pd.DataFrame(index=recent_dates, columns=score_raw_today_bear.index)
for dt in recent_dates:
    r_rs_h = rs_fixed.loc[dt].rank(pct=True)
    r_corr_h = (-corr_mkt).loc[dt].rank(pct=True)
    r_dd_h = (-dd).loc[dt].rank(pct=True)
    recent_adjusted_bear.loc[dt] = r_rs_h * w_bear['rs'] + r_corr_h * w_bear['corr'] + r_dd_h * w_bear['dd']

df_h_bear = pd.DataFrame({
    "score": score_raw_today_bear.reindex(fixed_hold_ids),
    "close": price.loc[latest_dt].reindex(fixed_hold_ids),
    "rs_pct": r_rs_today.reindex(fixed_hold_ids),
    "dd_pct": r_dd_today.reindex(fixed_hold_ids),
    "corr_pct": r_corr_today.reindex(fixed_hold_ids),
    "passed_filter": final_cond.loc[latest_dt].reindex(fixed_hold_ids)
})
df_h_bear = df_h_bear.sort_values("score", ascending=False).copy()
df_h_bear["base_rank"] = range(1, len(df_h_bear) + 1)
current_holdings_rank_bear = [build_stock_item(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"]) for sid, row in df_h_bear.iterrows()]

df_f_bear = pd.DataFrame({
    "score": score_raw_today_bear.reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "rs_pct": r_rs_today.reindex(filtered_ids),
    "dd_pct": r_dd_today.reindex(filtered_ids),
    "corr_pct": r_corr_today.reindex(filtered_ids),
    "passed_filter": True
})
df_f_bear = df_f_bear.sort_values("score", ascending=False).copy()
df_f_bear["base_rank"] = range(1, len(df_f_bear) + 1)
filtered_rank_bear = [build_stock_item(sid, row, row["base_rank"], prev_filtered_rank_map, False, True) for sid, row in df_f_bear.iterrows()]

df_m_bear = pd.DataFrame({
    "score": score_raw_today_bear,
    "close": price.loc[latest_dt].reindex(score_raw_today_bear.index),
    "rs_pct": r_rs_today.reindex(score_raw_today_bear.index),
    "dd_pct": r_dd_today.reindex(score_raw_today_bear.index),
    "corr_pct": r_corr_today.reindex(score_raw_today_bear.index),
    "passed_filter": final_cond.loc[latest_dt].reindex(score_raw_today_bear.index).fillna(False)
})
df_m_bear = df_m_bear[df_m_bear["score"] > 0].copy()
df_m_bear = df_m_bear.sort_values("score", ascending=False)
df_m_bear["base_rank"] = range(1, len(df_m_bear) + 1)
market_rank_bear = [item for item in [build_stock_item(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"])) for sid, row in df_m_bear.iterrows()] if item is not None]

current_holdings_rank_bear = add_history_to_items(current_holdings_rank_bear, recent_adjusted_bear)
filtered_rank_bear = add_history_to_items(filtered_rank_bear, recent_adjusted_bear)
market_rank_bear = add_history_to_items(market_rank_bear, recent_adjusted_bear)

# ================= 🛠️ 【核心修改點二】將牛市算好的正確天數精準同步給熊市篩選榜 =================
for item in filtered_rank_bear:
    sid = item["stock_id"]
    if sid in today_filtered_days_map:
        # 完美與牛市當日的最終天數對齊
        item["filter_days"] = today_filtered_days_map[sid]
    else:
        # 極少數例外狀況：若該股今天只出現在熊市榜，則比對舊歷史資料處理
        yesterday_days = prev_days_map.get(sid, 0)
        if is_same_day:
            item["filter_days"] = yesterday_days if yesterday_days > 0 else 1
        else:
            item["filter_days"] = yesterday_days + 1

# 💡 乾淨度保證：熊市的持股與全市場排名不加入任何天數欄位
# =========================================================================

result_bear_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(execution_dt.date()),
    "next_rebalance_date": str(next_rebalance_dt.date()), # 新增下次執行日
    "overview": overview,
    "current_holdings_rank": current_holdings_rank_bear,
    "filtered_rank": filtered_rank_bear,
    "market_rank": market_rank_bear
}

Path("public").mkdir(parents=True, exist_ok=True)
with open("public/result.json", 'w', encoding='utf-8') as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2)
with open("public/result_bear.json", 'w', encoding='utf-8') as f:
    json.dump(result_bear_json, f, ensure_ascii=False, indent=2)
with open("public/chart_data.json", 'w', encoding='utf-8') as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)
print(f"✅ 更新完成！")
