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
import twstock   # 新增：用來取得股票「上市 / 上櫃」標籤

print("🚀 執行：高息低波策略（欄位與排序真正對齊版）自動化更新...")

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

# 綜合濾網
final_cond = dy_filter & liq_filter & ma_filter

# === 四、評分 ===
std_score = std240.rank(axis=1, pct=True, ascending=False)
dy_score = dy_rank
score_raw_today = dy_score * 0.33 + std_score * 0.67

# =============================================================================
# 五、選股迴圈（精準嚴格防呆版：金融最多4檔 + 補滿12檔）
# =============================================================================
max_holdings = 12
max_financial = 4

loop_score = score_raw_today.where(final_cond)
raw_position = pd.DataFrame(0, index=loop_score.index, columns=loop_score.columns, dtype=int)

for dt in loop_score.index:
    row_score = loop_score.loc[dt].dropna()
    if len(row_score) == 0:
        continue
      
    # 依分數由大到小排序
    s = row_score.sort_values(ascending=False)
    
    selected = []
    fin_count = 0
    
    # 嚴格按順序掃描所有合格股票
    for stock in s.index:
        fin_flag = is_fin.get(stock, False)
        
        if fin_flag:
            if fin_count < max_financial:
                selected.append(stock)
                fin_count += 1
        else:
            selected.append(stock)
            
        if len(selected) >= max_holdings:
            break
            
    # 【安全備用池】若掃完一輪非金融股不足，導致總持股不滿 12 檔，則放寬限制用剩餘金融股補滿
    if len(selected) < max_holdings:
        remaining = [stk for stk in s.index if stk not in selected]
        for stock in remaining:
            selected.append(stock)
            if len(selected) >= max_holdings:
                break
                
    raw_position.loc[dt, selected] = 1

# =============================================================================
# 六、漲停買不到濾網
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
    benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
    report_x.benchmark = benchmark.reindex(report_x.creturn.index).ffill()

print("✅ 回測執行完成！開始精準生成三頁排名資料...")

# =============================================================================
# 八、精準脫水前端 JSON 生成邏輯
# =============================================================================
common_index = price.index.intersection(dy_rank.index).intersection(std_score.index).intersection(final_cond.index)
available_dates = common_index[final_cond.loc[common_index].any(axis=1)]
latest_dt = available_dates.max()

print(f"✅ 最新資料日期 (依據資料庫實際現況): {latest_dt.date()}")

def get_rebalance_date_qe_jan(dt):
    y, m = dt.year, dt.month
    if m <= 1: return pd.Timestamp(f"{y-1}-10-31")
    elif m <= 4: return pd.Timestamp(f"{y}-01-31")
    elif m <= 7: return pd.Timestamp(f"{y}-04-30")
    elif m <= 10: return pd.Timestamp(f"{y}-07-31")
    else: return pd.Timestamp(f"{y}-10-31")

real_rebalance_dt = get_rebalance_date_qe_jan(latest_dt)
# 1. 取得交易日曆
trading_days = data.get('price:收盤價').index

# 2. 取得基準日 (T) - 這是月底 (例如 4/30)
base_date = get_rebalance_date_qe_jan(latest_dt)

# 3. 計算本次換倉執行日 (T+1 順延)
idx = trading_days.searchsorted(base_date)
if idx < len(trading_days) and trading_days[idx] == base_date:
    idx += 1
execution_dt = trading_days[idx] if idx < len(trading_days) else trading_days[-1]

# 1. 取得交易日曆
trading_days = data.get('price:收盤價').index

# 2. 取得基準日 (T) - 這是月底 (例如 4/30)
base_date = get_rebalance_date_qe_jan(latest_dt)

# 3. 計算本次換倉執行日 (T+1 順延)
idx = trading_days.searchsorted(base_date)
if idx < len(trading_days) and trading_days[idx] == base_date:
    idx += 1
execution_dt = trading_days[idx] if idx < len(trading_days) else trading_days[-1]

# 4. 【關鍵點】計算下次預計換倉日 (尊重您的位移邏輯)
# 邏輯：不使用 QuarterEnd(1)，改用簡單的月份位移，確保 4/30 -> 7/31 的精確性
next_month = base_date.month + 3
next_year = base_date.year
if next_month > 12:
    next_month -= 12
    next_year += 1

# 找到該月最後一天作為基準日
# 這裡使用最後一天 (例如 7/31)，確保邏輯與您原本的位移完全對應
import calendar
last_day = calendar.monthrange(next_year, next_month)[1]
next_base_date = pd.Timestamp(next_year, next_month, last_day)

# 在交易日曆中搜尋這個「位移後」的基準日
next_idx = trading_days.searchsorted(next_base_date)

# 強制執行 T+1：
# 如果 searchsorted 找到的日期 <= next_base_date，就加 1，確保執行日是「基準日」的下一個交易日
if next_idx < len(trading_days):
    if trading_days[next_idx] <= next_base_date:
        next_idx += 1
    
    # 再次檢查越界
    if next_idx < len(trading_days):
        next_rebalance_dt = trading_days[next_idx]
    else:
        next_rebalance_dt = trading_days[-1]
else:
    # Fallback (當資料庫未更新到未來時)
    next_rebalance_dt = next_base_date + pd.Timedelta(days=1)
    while next_rebalance_dt.dayofweek >= 5: # 確保避開週末
        next_rebalance_dt += pd.Timedelta(days=1)

print(f"DEBUG: 基準日 {base_date.date()} -> 換倉執行日 {execution_dt.date()} -> 下次預計 {next_rebalance_dt.date()}")
# 公司與產業映射
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# 工具函數
def score_to_display(val):
    if pd.isna(val): return 42.9
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
    df = df.copy().dropna(subset=[score_col]).sort_values(score_col, ascending=False)
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

# 濾網切片
dy_filter_series = dy_filter.loc[latest_dt]
liq_filter_series = liq_filter.loc[latest_dt]
ma_filter_series = ma_filter.loc[latest_dt]
dy_rank_series = dy_rank.loc[latest_dt]

def get_failed_conditions_high_div(sid):
    fail = []
    sid_str = str(sid)
    if not dy_filter_series.get(sid_str, False):
        dy_val = dy_rank_series.get(sid_str, np.nan)
        if pd.notna(dy_val):
            if dy_val <= 0.6:
                fail.append("殖利率過低")
            if dy_val >= 0.9:
                fail.append("殖利率過高")
    if not liq_filter_series.get(sid_str, False):
        fail.append("流通性不足")
    if not ma_filter_series.get(sid_str, False):
        fail.append("股價未站上年線")
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
        "market": get_market_type(sid),   # 新增：上市 / 上櫃 標籤（只顯示用）
        "score": round(float(row.get("score", 0)), 6),
        "display_score": score_to_display(row.get("score")),
        "close": float(row.get("close")) if pd.notna(row.get("close")) else None,
        "dy_pct": pct_win(row.get("dy_pct")),
        "std_pct": pct_win(row.get("std_pct")),
    }
    # 新增：換倉至今報酬（僅「目前持股排名」的 df 有帶 rebalance_close 欄位才會算）
    # 優先採用 report.position_info() 算出來的含息報酬（跟 FinLab 網站上的「持股盈虧」一致）；
    # 抓不到時（極少數例外）才退回用「收盤價」自算純價格報酬（不含息，僅供 fallback）。
    if "rebalance_close" in row.index:
        rebalance_close_val = row.get("rebalance_close")
        close_val = row.get("close")
        if pd.notna(rebalance_close_val):
            item["rebalance_close"] = float(rebalance_close_val)
        override_ret = row.get("position_return_pct") if "position_return_pct" in row.index else None
        if override_ret is not None and pd.notna(override_ret):
            item["return_since_rebalance_pct"] = round(float(override_ret), 2)
        elif pd.notna(rebalance_close_val) and pd.notna(close_val) and float(rebalance_close_val) != 0:
            item["return_since_rebalance_pct"] = round((float(close_val) / float(rebalance_close_val) - 1) * 100, 2)
    if selected is not None: item["selected"] = bool(selected)
    if passed_filter is not None:
        item["passed_filter"] = bool(passed_filter)
        item["failed_conditions"] = [] if bool(passed_filter) else get_failed_conditions_high_div(sid)
    return item

def normalize_pct(series, active_mask=None):
    if active_mask is not None:
        s = series[active_mask].dropna()
    else:
        s = series.dropna()
    if s.empty:
        return series
    normalized = series / s.max()
    normalized = normalized.clip(upper=1.0)
    if active_mask is not None:
        active_max_idx = normalized[active_mask].idxmax()
        if pd.notna(active_max_idx):
            normalized = normalized.copy()
            normalized.loc[active_max_idx] = 1.0
    return normalized

# ====================== 新增：從 report.position_info() 取得「進場價 + 含息報酬」======================
# FinLab 的 report 物件（sim() 的回傳值）內部已經處理好進場價（對齊 trade_at_price='open'）
# 與含息報酬，跟 studio.finlab.finance 網頁上「持股」頁籤看到的數字是同一套邏輯算出來的，
# 直接抓來用最準，不用自己拿收盤價重算（收盤價沒還原股息，且進場價基準也對不齊）。
def get_position_info_lookup(report_obj):
    try:
        pos_info = report_obj.position_info()
    except Exception as e:
        print(f"⚠️ report.position_info() 取得失敗，換倉至今報酬將退回用收盤價自算：{e}")
        return {}
    lookup = {}
    for key, info in pos_info.items():
        if not isinstance(info, dict):
            continue  # 跳過 update_date / next_trading_date 等 meta 欄位
        if info.get("status") not in ("hold", "exit"):
            continue  # 'enter' 是還沒開始的新部位，還沒有報酬可看
        entry_price = info.get("entry_price")
        ret = info.get("return")
        if entry_price is None or ret is None or pd.isna(entry_price) or pd.isna(ret):
            continue
        sid = str(key).split(" ", 1)[0].strip()
        lookup[sid] = {"entry_price": float(entry_price), "return_pct": float(ret) * 100}
    return lookup

position_info_lookup = get_position_info_lookup(report_x)

# ====================== 產生歷史固定持股名單（同步修正為安全防防呆邏輯） ======================
rb_score = loop_score.loc[real_rebalance_dt].dropna().sort_values(ascending=False)

fixed_hold_ids = []
fin_count_rb = 0

for stock in rb_score.index:
    fin_flag = is_fin.get(stock, False)
    if fin_flag:
        if fin_count_rb < max_financial:
            fixed_hold_ids.append(stock)
            fin_count_rb += 1
    else:
        fixed_hold_ids.append(stock)
        
    if len(fixed_hold_ids) >= max_holdings:
        break

if len(fixed_hold_ids) < max_holdings:
    remaining_rb = [stk for stk in rb_score.index if stk not in fixed_hold_ids]
    for stock in remaining_rb:
        fixed_hold_ids.append(stock)
        if len(fixed_hold_ids) >= max_holdings:
            break

# =============================================================================
# 當日因子歸一化
# =============================================================================
active_today = price.loc[latest_dt].notna()

dy_pct_today = normalize_pct(dy_rank.loc[latest_dt])
std_pct_today = normalize_pct(std_score.loc[latest_dt], active_mask=active_today)

print(f"🔍 DEBUG: std_pct_today max = {std_pct_today.max():.4f}")
print(f"    DY max = {dy_pct_today.max():.4f}")

clean_score_today = dy_pct_today * 0.33 + std_pct_today * 0.67

# 歷史 7 天前對比基準計算
compare_dt = get_compare_dt(score_raw_today.index, latest_dt, days=7)
prev_current_holdings_rank_map = {}
prev_filtered_rank_map = {}
prev_market_rank_map = {}

if compare_dt is not None:
    dy_pct_prev = normalize_pct(dy_rank.loc[compare_dt])
    std_pct_prev = normalize_pct(std_score.loc[compare_dt])
    clean_score_prev = dy_pct_prev * 0.33 + std_pct_prev * 0.67
    
    df_h_prev = pd.DataFrame({"score": clean_score_prev.reindex(fixed_hold_ids)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
  
    filtered_ids_prev = final_cond.loc[compare_dt][final_cond.loc[compare_dt]].index
    df_f_prev = pd.DataFrame({"score": clean_score_prev.reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
  
    df_m_prev = pd.DataFrame({"score": clean_score_prev})
    df_m_prev = df_m_prev[df_m_prev["score"] > 0]
    prev_market_rank_map = build_rank_map(df_m_prev)

# ====================== 三頁排名資料組裝 ======================
# --- 1. 目前持股排名 ---
_rebalance_close_series = pd.Series(
    {sid: position_info_lookup.get(str(sid), {}).get("entry_price") for sid in fixed_hold_ids}
).fillna(price.loc[execution_dt].reindex(fixed_hold_ids))  # position_info() 抓不到時才退回換倉執行日收盤價
_position_return_series = pd.Series(
    {sid: position_info_lookup.get(str(sid), {}).get("return_pct") for sid in fixed_hold_ids}
)
df_h = pd.DataFrame({
    "score": clean_score_today.reindex(fixed_hold_ids),
    "close": price.loc[latest_dt].reindex(fixed_hold_ids),
    "rebalance_close": _rebalance_close_series,  # 新增：換倉日進場價，用來算換倉至今報酬
    "position_return_pct": _position_return_series,  # 新增：FinLab report 算好的含息換倉至今報酬（優先採用）
    "dy_pct": dy_pct_today.reindex(fixed_hold_ids),
    "std_pct": std_pct_today.reindex(fixed_hold_ids),
    "passed_filter": final_cond.loc[latest_dt].reindex(fixed_hold_ids).fillna(False)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)
current_holdings_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"]) for sid, row in df_h.iterrows()]

# ====================== 新增：換倉至今報酬總覽（整體持倉，供首頁「換倉至今表現」頁使用）======================
# 上漲/下跌/持平家數這種細項不在這裡算，前端直接用 current_holdings_rank 裡每檔的
# return_since_rebalance_pct 自己算就好，後端只出「整體等權重平均報酬」這一個數字。
_since_rebalance_returns = [
    item["return_since_rebalance_pct"]
    for item in current_holdings_rank
    if item and item.get("return_since_rebalance_pct") is not None
]
since_rebalance_summary = {
    "date": str(execution_dt.date()),
    "return_pct": round(float(np.mean(_since_rebalance_returns)), 2) if _since_rebalance_returns else None,
}

# --- 2. 條件篩選排名 ---
filtered_ids = final_cond.loc[latest_dt][final_cond.loc[latest_dt]].index
df_f = pd.DataFrame({
    "score": clean_score_today.reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "dy_pct": dy_pct_today.reindex(filtered_ids),
    "std_pct": std_pct_today.reindex(filtered_ids),
    "passed_filter": True
})
df_f = df_f.dropna(subset=["score"]).sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)
filtered_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_filtered_rank_map, False, True) for sid, row in df_f.iterrows()]

# --- 3. 全市場排名 ---
df_m = pd.DataFrame({
    "score": clean_score_today,
    "close": price.loc[latest_dt],
    "dy_pct": dy_pct_today,
    "std_pct": std_pct_today,
    "passed_filter": final_cond.loc[latest_dt]
})
df_m = df_m[df_m["score"] > 0].copy().sort_values("score", ascending=False)
df_m["base_rank"] = range(1, len(df_m) + 1)
market_rank = [build_stock_item_high_div(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"])) for sid, row in df_m.iterrows()]

# ====================== 歷史走勢（加強版） ======================
def add_history_to_items(items):
    if len(items) == 0: return items
    all_dates = score_raw_today.index
    past_dates = all_dates[all_dates <= latest_dt][-5:]
    sub_df = pd.DataFrame(index=past_dates, columns=score_raw_today.columns)
    for dt in past_dates:
        active_dt = price.loc[dt].notna()
        dy_pct_h = normalize_pct(dy_rank.loc[dt])
        std_pct_h = normalize_pct(std_score.loc[dt], active_mask=active_dt)
        clean_h = dy_pct_h * 0.33 + std_pct_h * 0.67
        sub_df.loc[dt] = clean_h.map(score_to_display)
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

current_holdings_rank = add_history_to_items(current_holdings_rank)
filtered_rank = add_history_to_items(filtered_rank)
market_rank = add_history_to_items(market_rank)

# ====================== 嚴謹版 filter_days：比對上一個實際 result_2.json ======================
PREV_RESULT_FILE_HIGH_DIV = Path("public/result_2.json")

def update_filter_days_with_prev_result_high_div(rank_list, latest_dt):
    if not rank_list:
        return

    prev_days_map = {}
    is_same_day = False
    current_date_str = str(latest_dt.date())

    if PREV_RESULT_FILE_HIGH_DIV.exists():
        try:
            prev_data = json.loads(PREV_RESULT_FILE_HIGH_DIV.read_text(encoding="utf-8"))
            prev_date_str = prev_data.get("latest_date")
            
            if prev_date_str == current_date_str:
                is_same_day = True
                print(f"📅 高息低波：資料日期相同 ({current_date_str})，判定為非交易日或同日重複執行 → 鎖定天數不變。")
            
            for item in prev_data.get("filtered_rank", []):
                sid = item.get("stock_id")
                if sid:
                    prev_days_map[sid] = item.get("filter_days", 1)
        except Exception as e:
            print(f"⚠️ 讀取上一個 result_2.json 失敗: {e}")

    for item in rank_list:
        sid = item["stock_id"]
        if is_same_day:
            item["filter_days"] = prev_days_map.get(sid, 1)
        else:
            if sid in prev_days_map:
                item["filter_days"] = prev_days_map[sid] + 1
            else:
                item["filter_days"] = 1

    print(f"✅ 高息低波：濾網天數計算完成！模式: {'[鎖定不動]' if is_same_day else '[跨日累加]'}")

update_filter_days_with_prev_result_high_div(filtered_rank, latest_dt)

# =============================================================================
# 九、計算 Overview 績效指標與圖表
# =============================================================================
daily_return = report_x.creturn.pct_change().fillna(0)

def calc_performance(ret_series, start_date=None):
    if start_date: ret_series = ret_series.loc[start_date:]
    if len(ret_series) == 0:
        return {"total_return": 0.0, "annual_return": 0.0, "max_drawdown": 0.0, "volatility": 0.0,
                "sharpe_ratio": 0.0, "sortino_ratio": 0.0, "calmar_ratio": 0.0}
    cum = (1 + ret_series).cumprod()
    total_ret = (cum.iloc[-1] - 1) * 100 if len(cum) > 0 else 0
    days = (ret_series.index[-1] - ret_series.index[0]).days if len(ret_series) > 1 else 1
    years = days / 365.25
    annual_ret = ((1 + total_ret/100) ** (1/years) - 1) * 100 if years > 0 else 0
    max_dd = ((cum / cum.cummax()) - 1).min() * 100
    vol = ret_series.std() * np.sqrt(252) * 100
    sharpe = (ret_series.mean() * 252 - 0.02) / (ret_series.std() * np.sqrt(252)) if ret_series.std() != 0 else 0
    downside_std = ret_series[ret_series < 0].std()
    sortino = (ret_series.mean() * 252 - 0.02) / (downside_std * np.sqrt(252)) if downside_std and downside_std != 0 else 0
    calmar = (annual_ret / abs(max_dd)) if max_dd != 0 else 0
    return {
        "total_return": round(total_ret, 2),
        "annual_return": round(annual_ret, 2),
        "max_drawdown": round(max_dd, 2),
        "volatility": round(vol, 2),
        "sharpe_ratio": round(sharpe, 2),
        "sortino_ratio": round(sortino, 2),
        "calmar_ratio": round(calmar, 2),
    }

def calc_top_drawdowns(nav_series, top_n=5):
    """找出前 N 個非重疊的回撤週期（依回撤幅度由深到淺排序）。
    一個週期定義為：從創新高的高點開始，一直到 nav 再次回到（或超過）該高點為止；
    若一路盤整未創新高就會被視為同一個週期，直到真的突破舊高點才算回補。"""
    nav_series = nav_series.dropna()
    running_max = nav_series.cummax()
    drawdown = (nav_series / running_max) - 1
    at_high = (drawdown == 0)

    episodes = []
    in_drawdown = False
    episode_start = None
    last_high_date = nav_series.index[0]

    for dt in nav_series.index:
        if at_high.loc[dt]:
            if in_drawdown:
                episodes.append((episode_start, dt))
                in_drawdown = False
            last_high_date = dt
        else:
            if not in_drawdown:
                in_drawdown = True
                episode_start = last_high_date

    if in_drawdown:
        episodes.append((episode_start, None))

    results = []
    for peak_date, recovery_date in episodes:
        end_date = recovery_date if recovery_date is not None else nav_series.index[-1]
        segment = drawdown.loc[peak_date:end_date]
        trough_date = segment.idxmin()
        max_dd_pct = float(segment.loc[trough_date]) * 100
        results.append({
            "max_drawdown": round(max_dd_pct, 2),
            "peak_date": str(peak_date.date()),
            "trough_date": str(trough_date.date()),
            "duration_days": int((trough_date - peak_date).days),
            "recovery_date": str(recovery_date.date()) if recovery_date is not None else None,
            "recovery_days": int((recovery_date - trough_date).days) if recovery_date is not None else None,
            "recovered": recovery_date is not None,
        })

    results.sort(key=lambda r: r["max_drawdown"])
    return results[:top_n]

def calc_drawdown_stats(nav_series):
    """單一最大回撤的高點日、低點日、回撤天數、回補天數（即 calc_top_drawdowns 的第一名，避免兩套邏輯各算各的）"""
    return calc_top_drawdowns(nav_series, top_n=1)[0]

def calc_yearly_returns(nav_series):
    """依日曆年切分，回傳每年報酬率（%）"""
    nav_series = nav_series.dropna()
    years = sorted(nav_series.index.year.unique())
    out = []
    for i, y in enumerate(years):
        year_data = nav_series[nav_series.index.year == y]
        if len(year_data) == 0:
            continue
        end_val = year_data.iloc[-1]
        if i == 0:
            start_val = year_data.iloc[0]
        else:
            prev_year_data = nav_series[nav_series.index.year == years[i - 1]]
            start_val = prev_year_data.iloc[-1] if len(prev_year_data) > 0 else year_data.iloc[0]
        ret = (end_val / start_val - 1) * 100 if start_val else 0
        out.append({"year": int(y), "return": round(float(ret), 2)})
    return out

def calc_yearly_max_drawdown(nav_series):
    """依日曆年切分，各自獨立算出「當年度自己的」最大回撤：只看年內自己的高點到低點，
    不管前一年留下來的舊高點、也不管有沒有回補——單純回答「這一年裡最慘跌了多少」。"""
    nav_series = nav_series.dropna()
    out = []
    for y in sorted(nav_series.index.year.unique()):
        year_data = nav_series[nav_series.index.year == y]
        if len(year_data) == 0:
            continue
        running_max = year_data.cummax()
        drawdown = (year_data / running_max) - 1
        out.append({"year": int(y), "max_drawdown": round(float(drawdown.min()) * 100, 2)})
    return out

def calc_monthly_returns(nav_series):
    """依日曆年月切分，回傳每月報酬率（%），供熱力圖使用"""
    nav_series = nav_series.dropna()
    month_end = nav_series.resample('ME').last().dropna()
    if len(month_end) == 0:
        return []
    monthly_ret = month_end.pct_change() * 100
    monthly_ret.iloc[0] = (month_end.iloc[0] / nav_series.iloc[0] - 1) * 100
    return [
        {"year": int(dt.year), "month": int(dt.month), "return": round(float(val), 2)}
        for dt, val in monthly_ret.items()
    ]

def calc_rolling_return(nav_series, window=252):
    """滾動年化報酬（預設1年期，252個交易日）：每個時點往回看 window 天的年化報酬率"""
    nav_series = nav_series.dropna()
    rolling = (nav_series / nav_series.shift(window)) - 1
    return rolling * 100

perf_all = calc_performance(daily_return)

# 【對齊回測期間】report_x.benchmark 可能帶有比策略回測更長的原始歷史，若直接拿來算報酬/MDD
# 會變成跟策略不同期間的比較。這裡強制裁切成跟 report_x.creturn 完全相同的日期範圍（無條件執行，
# 不是只在 finlab 沒自動附上 benchmark 時才做，避免同樣的期間不對齊問題）。
benchmark_aligned = report_x.benchmark.reindex(report_x.creturn.index).ffill()
benchmark_daily_return = benchmark_aligned.pct_change().fillna(0)
perf_benchmark = calc_performance(benchmark_daily_return)

yearly_strategy = calc_yearly_returns(report_x.creturn)
yearly_benchmark_map = {b["year"]: b["return"] for b in calc_yearly_returns(benchmark_aligned)}

yearly_mdd_strategy = calc_yearly_max_drawdown(report_x.creturn)
yearly_mdd_benchmark_map = {b["year"]: b["max_drawdown"] for b in calc_yearly_max_drawdown(benchmark_aligned)}

# 策略驗證①：滾動1年報酬（策略 vs 大盤）
rolling_strategy = calc_rolling_return(report_x.creturn)
rolling_benchmark = calc_rolling_return(benchmark_aligned)
rolling_combined = pd.DataFrame({"strategy": rolling_strategy, "benchmark": rolling_benchmark}).dropna()
rolling_weekly = rolling_combined.resample('W-FRI').last().dropna()
rolling_1y_return = [
    {"date": str(dt.date()), "strategy": round(float(row["strategy"]), 2), "benchmark": round(float(row["benchmark"]), 2)}
    for dt, row in rolling_weekly.iterrows()
]

# ====================== 策略驗證②：分數 vs 遠期報酬率（因子評分是否真的有效）======================
# 用 score_raw_today（跟真正選股完全一致的全市場排名分數），限定在通過濾網 final_cond 的個股才納入統計。
# T+1 開盤進場、持有90天後開盤出場，避免用訊號當天收盤價偷看未來。
# 用「風險調整效率」（該分數區間報酬的平均值 / 橫截面標準差）取代單純平均報酬，
# 避免少數極端值把平均報酬拉高、造成誤判分數越高越好。
print("🚀 開始計算分數與報酬率驗證...")
SCORE_VALIDATION_FORWARD_DAYS = 90
actual_entry = open_p.shift(-1)
actual_exit = open_p.shift(-1 - SCORE_VALIDATION_FORWARD_DAYS)
fwd_return_matrix = (actual_exit / actual_entry - 1) * 100
display_score_matrix = score_raw_today.map(score_to_display)

score_flat = display_score_matrix.stack()
ret_flat = fwd_return_matrix.stack()
passed_flat = final_cond.stack()
score_ret_df = pd.DataFrame({"score": score_flat, "ret": ret_flat, "passed": passed_flat}).dropna(subset=["score", "ret"])
score_ret_df = score_ret_df[score_ret_df["passed"].fillna(False)]

SCORE_BIN_EDGES = [0, 60, 70, 80, 90, 100.01]
SCORE_BIN_LABELS = ["<60", "60-70", "70-80", "80-90", "90-100"]
score_ret_df["bin"] = pd.cut(score_ret_df["score"], bins=SCORE_BIN_EDGES, labels=SCORE_BIN_LABELS, right=False)

score_return_validation = []
for label in SCORE_BIN_LABELS:
    sub = score_ret_df[score_ret_df["bin"] == label]
    if len(sub) == 0:
        continue
    ret_mean = float(sub["ret"].mean())
    ret_std = float(sub["ret"].std())
    score_return_validation.append({
        "bin": label,
        "avg_return": round(ret_mean, 2),
        "efficiency": round(ret_mean / ret_std, 3) if ret_std else 0.0,
        "win_rate": round(float((sub["ret"] > 0).mean() * 100), 1),
        "n": int(len(sub)),
    })
print(f"✅ 分數驗證完成，共 {len(score_ret_df)} 筆（僅通過濾網的日期×股票，T+1開盤進場）樣本，forward={SCORE_VALIDATION_FORWARD_DAYS} 個交易日")

overview = {
    "start_date": "2010-03-31",
    "total_return_all": perf_all["total_return"],
    "annual_return_all": perf_all["annual_return"],
    "total_return_ytd": calc_performance(daily_return, f"{datetime.now().year}-01-01")["total_return"],
    "total_return_1y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-1))["total_return"],
    "total_return_3y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-3))["total_return"],
    "total_return_5y": calc_performance(daily_return, datetime.now().replace(year=datetime.now().year-5))["total_return"],
    "max_drawdown": perf_all["max_drawdown"],
    "volatility_all": perf_all["volatility"],
    "sharpe_ratio": perf_all["sharpe_ratio"],
    "sortino_ratio": perf_all["sortino_ratio"],
    "calmar_ratio": perf_all["calmar_ratio"],
    "current_holdings": int(max_holdings),
    "drawdown_detail": calc_drawdown_stats(report_x.creturn),
    "top_drawdowns": calc_top_drawdowns(report_x.creturn, 5),
    "benchmark": {
        "total_return_all": perf_benchmark["total_return"],
        "annual_return_all": perf_benchmark["annual_return"],
        "max_drawdown": perf_benchmark["max_drawdown"],
        "volatility_all": perf_benchmark["volatility"],
        "sharpe_ratio": perf_benchmark["sharpe_ratio"],
        "sortino_ratio": perf_benchmark["sortino_ratio"],
        "calmar_ratio": perf_benchmark["calmar_ratio"],
        "drawdown_detail": calc_drawdown_stats(benchmark_aligned),
        "top_drawdowns": calc_top_drawdowns(benchmark_aligned, 5),
    },
    "yearly_returns": [
        {"year": s["year"], "strategy": s["return"], "benchmark": yearly_benchmark_map.get(s["year"])}
        for s in yearly_strategy
    ],
    "yearly_max_drawdown": [
        {"year": s["year"], "strategy": s["max_drawdown"], "benchmark": yearly_mdd_benchmark_map.get(s["year"])}
        for s in yearly_mdd_strategy
    ],
    "monthly_returns": calc_monthly_returns(report_x.creturn),
    "rolling_1y_return": rolling_1y_return,
    "score_return_validation": {
        "forward_days": SCORE_VALIDATION_FORWARD_DAYS,
        "metric": "efficiency",
        "bins": score_return_validation,
    },
    "since_rebalance": since_rebalance_summary,  # 新增：整體持倉換倉至今報酬摘要
}

def get_pts(series, benchmark_series, start_dt, period=None):
    start_dt = pd.to_datetime(start_dt).tz_localize(None) if not isinstance(start_dt, str) else pd.to_datetime(start_dt)
    mask = series.index >= start_dt
    target = series[mask]
    target_bench = benchmark_series.reindex(target.index).ffill()
    if len(target) == 0: 
        return []
    if period in ['5年', '全部']:
        target = target.resample('W-FRI').last().dropna()
        target_bench = target_bench.resample('W-FRI').last().dropna()
    base, base_bench = target.iloc[0], target_bench.iloc[0]
    norm = ((target / base) - 1) * 100
    norm_bench = ((target_bench / base_bench) - 1) * 100
    return [
        {
            "date": d.strftime('%Y-%m-%d'),
            "returns": round(float(norm.loc[d]), 2),
            "benchmark": round(float(norm_bench.loc[d]), 2)
        }
        for d in target.index
    ]

now = datetime.now(ZoneInfo("Asia/Taipei"))
chart_json = {
    "今年": get_pts(report_x.creturn, report_x.benchmark, f"{now.year}-01-01", period="今年"),
    "1年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=365), period="1年"),
    "5年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=5*365), period="5年"),
    "全部": get_pts(report_x.creturn, report_x.benchmark, report_x.creturn.index.min(), period="全部")
}

if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    overview["total_return_ytd"] = round(float(chart_json["今年"][-1]["returns"]), 2)

# ====================== 最終 JSON 輸出 ======================
result_json = {
    "latest_date": str(latest_dt.date()),
    "updated_at": datetime.now(ZoneInfo("Asia/Taipei")).strftime('%Y-%m-%d %H:%M'),
    "compare_date": str(compare_dt.date()) if compare_dt else None,
    "rebalance_base_date": str(execution_dt.date()),         # 修改為換倉執行日
    "next_rebalance_date": str(next_rebalance_dt.date()), # 新增下次執行日
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

print(f"============== ✅ 高息低波 已完成（含 filter_days + 日期保護） ==============")
