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

print("🚀 執行：高息低波策略（QE-JAN 12檔完美版）自動化更新...")

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
rev_m = data.get('monthly_revenue:當月營收').loc['2006':'2026']

# === 二、產業資料（金融判定）===
info = data.get('company_basic_info')
industry_map = info.set_index('stock_id')['產業類別'].astype(str)
is_fin = industry_map.str.contains('金融').fillna(False)

# 對齊欄位格式
for df in [price, open_p, yield_ratio, vol]:
    df.columns = df.columns.astype(str)

# === 三、因子 ===
ma240 = price.rolling(240).mean()

liq_filter = vol.rank(axis=1, pct=True) > 0.5
ma_filter = price > ma240

std240 = price.ffill().pct_change(fill_method=None).rolling(240).std()

dy_rank = yield_ratio.rank(axis=1, pct=True)
dy_filter = (dy_rank > 0.6) & (dy_rank < 0.9)

# === 四、評分 ===
std_score = std240.rank(axis=1, pct=True, ascending=False)
dy_score = dy_rank
raw_score = dy_score * 0.33 + std_score * 0.67

final_filter = dy_filter & liq_filter & ma_filter
score = raw_score.where(final_filter)

# =============================================================================
# 五、選股迴圈（金融最多4檔 + 補滿12檔）
# =============================================================================
max_holdings = 12
max_financial = 4
candidate_n = 25

raw_position = pd.DataFrame(0, index=score.index, columns=score.columns, dtype=int)

for dt in score.index:
    # 🛡️ 防禦性：第一年因為 rolling(240) 會全為 NaN，直接跳過避免錯誤
    row_score = score.loc[dt].dropna()
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
# 六、漲停買不到濾網 (🛠️ 修正時區與形狀錯位 Bug)
# =============================================================================
limit_pct = pd.Series(0.095, index=price.index)
limit_pct.loc[:'2015-05-31'] = 0.065
limit_up_price_next = price.mul(1 + limit_pct, axis=0)

cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next
# 🛡️ 關鍵修正 1：強迫對齊與 raw_position 一模一樣的結構
cannot_buy_t1 = cannot_buy_t1.reindex_like(raw_position).fillna(False)

# 對齊 QE-JAN 的換股基準機制
target_pos_qe = raw_position.resample('QE-JAN').last()
prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

buy_order = raw_position > prev_position
position_final_x = raw_position.copy()

# 🛡️ 關鍵修正 2：確保矩陣運算後一定是純布林，且沒有任何 NaN 亂入
blocked_buy = (buy_order & cannot_buy_t1).astype(bool)

# 執行遮罩替代
position_final_x[blocked_buy] = prev_position[blocked_buy]

# =============================================================================
# 七、執行回測 (比照你的設定)
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

# 補充 benchmark 指數（chart_json 生成必備）
if not hasattr(report_x, 'benchmark') or report_x.benchmark is None:
    print("⚠️ 手動補充 benchmark（加權指數）")
    benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
    report_x.benchmark = benchmark.reindex(report_x.creturn.index).ffill()

print("✅ 回測執行完成！開始生成脫水版前端 JSON 資料...")

# =============================================================================
# 八、完美脫水版 JSON 生成邏輯
# =============================================================================
latest_dt = score.index[-1]
print(f"✅ 最新資料日期: {latest_dt.date()}")

# 精準對其 QE-JAN 的季度重分配基準日
def get_rebalance_date_qe_jan(dt):
    y, m = dt.year, dt.month
    if m <= 1:   return pd.Timestamp(f"{y-1}-10-31")
    elif m <= 4: return pd.Timestamp(f"{y}-01-31")
    elif m <= 7: return pd.Timestamp(f"{y}-04-30")
    elif m <= 10: return pd.Timestamp(f"{y}-07-31")
    else:        return pd.Timestamp(f"{y}-10-31")

real_rebalance_dt = get_rebalance_date_qe_jan(latest_dt)
print(f"✅ 本季換股基準日: {real_rebalance_dt.date()}")

# 🎯【誠實鎖定】：拒絕虛報！直接拿回測引擎最後一天的持有部位，確保與 12 檔完全精準對應
final_backtest_pos = report_x.position.iloc[-1]
holdings = final_backtest_pos[final_backtest_pos > 0].index
print(f"✅ 目前實際持股數量: {len(holdings)} 檔")

# 公司名稱字典對照
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]

# 輔助函數
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

# 提前提取最新一天的濾網切片 (向量化加速)
combined_filter_series = (dy_filter & liq_filter & ma_filter).loc[latest_dt]
dy_filter_series = dy_filter.loc[latest_dt]
liq_filter_series = liq_filter.loc[latest_dt]
ma_filter_series = ma_filter.loc[latest_dt]
dy_rank_series = dy_rank.loc[latest_dt]

def get_failed_conditions_high_div(sid):
    fail = []
    sid_str = str(sid)
    
    if not combined_filter_series.get(sid_str, False):
        dy_val = dy_rank_series.get(sid_str, np.nan)
        if pd.notna(dy_val) and (dy_val <= 0.6 or dy_val >= 0.9):
            fail.append("殖利率未在60%-90%間")
        else:
            fail.append("殖利率異常")
            
    if not liq_filter_series.get(sid_str, False):
        fail.append("流通性不足")
        
    if not ma_filter_series.get(sid_str, False):
        fail.append("股價未站上年線")
        
    return fail

def build_stock_item_high_div(sid, row, base_rank, prev_rank_map, selected=None, passed_filter=None, is_filtered=False):
    prev_rank, rank_change, change_type = get_rank_change_info(sid, prev_rank_map, int(base_rank), is_filtered)
    raw_score_val = row.get("score")
    valid_score = round(float(raw_score_val), 6) if pd.notna(raw_score_val) else None
    
    item = {
        "base_rank": int(base_rank),
        "prev_rank": prev_rank,
        "rank_change": rank_change,
        "change_type": change_type,
        "stock_id": str(sid),
        "name": str(company_short_name_map.get(str(sid), "")),
        "full_name": str(company_full_name_map.get(str(sid), "")),
        "industry": str(row.get("industry", "")),
        "score": valid_score,
        "display_score": score_to_display(raw_score_val),
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
    past_dates = raw_score.index[-5:]
    sub_df = raw_score.loc[past_dates].map(score_to_display)
    
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

# 歷史比對基準日
compare_dt = get_compare_dt(score.index, latest_dt, days=7)

prev_current_holdings_rank_map = {}
prev_filtered_rank_map = {}
prev_market_rank_map = {}

if compare_dt is not None:
    df_h_prev = pd.DataFrame({"score": raw_score.loc[compare_dt].reindex(holdings)})
    prev_current_holdings_rank_map = build_rank_map(df_h_prev)
    
    filtered_ids_prev = (dy_filter & liq_filter & ma_filter).loc[compare_dt]
    filtered_ids_prev = filtered_ids_prev[filtered_ids_prev].index
    df_f_prev = pd.DataFrame({"score": score.loc[compare_dt].reindex(filtered_ids_prev)})
    prev_filtered_rank_map = build_rank_map(df_f_prev)
    
    df_m_prev = pd.DataFrame({"score": raw_score.loc[compare_dt]}).dropna(subset=["score"])
    prev_market_rank_map = build_rank_map(df_m_prev)

# --- 1. 目前實際持股排名 ---
df_h = pd.DataFrame({
    "score": raw_score.loc[latest_dt].reindex(holdings),
    "close": price.loc[latest_dt].reindex(holdings),
    "dy_rank": dy_rank.loc[latest_dt].reindex(holdings),
    "std_rank": std_score.loc[latest_dt].reindex(holdings),
    "passed_filter": (dy_filter & liq_filter & ma_filter).loc[latest_dt].reindex(holdings),
    "industry": industry_map.reindex(holdings)
})
df_h = df_h.sort_values("score", ascending=False).copy()
df_h["base_rank"] = range(1, len(df_h) + 1)

current_holdings_rank = [
    build_stock_item_high_div(sid, row, row["base_rank"], prev_current_holdings_rank_map, True, row["passed_filter"], False)
    for sid, row in df_h.iterrows()
]
current_holdings_rank = add_history_to_items(current_holdings_rank)

# --- 2. 條件篩選排名 ---
filtered_ids = (dy_filter & liq_filter & ma_filter).loc[latest_dt]
filtered_ids = filtered_ids[filtered_ids].index
df_f = pd.DataFrame({
    "score": score.loc[latest_dt].reindex(filtered_ids),
    "close": price.loc[latest_dt].reindex(filtered_ids),
    "dy_rank": dy_rank.loc[latest_dt].reindex(filtered_ids),
    "std_rank": std_score.loc[latest_dt].reindex(filtered_ids),
    "passed_filter": True,
    "industry": industry_map.reindex(filtered_ids)
})
df_f = df_f.dropna(subset=["score"]) # 防禦性脫水
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)

filtered_rank = [
    build_stock_item_high_div(sid, row, row["base_rank"], prev_filtered_rank_map, False, True, True)
    for sid, row in df_f.iterrows()
]
filtered_rank = add_history_to_items(filtered_rank)

# --- 3. 全市場排名（🚀 誠實脫水核心）---
df_m = pd.DataFrame({
    "score": raw_score.loc[latest_dt],
    "close": price.loc[latest_dt],
    "dy_rank": dy_rank.loc[latest_dt],
    "std_rank": std_score.loc[latest_dt],
    "passed_filter": (dy_filter & liq_filter & ma_filter).loc[latest_dt],
    "industry": industry_map.reindex(raw_score.loc[latest_dt].index)
})

# 斬斷所有歷史殭屍股！只留下今天有報價、有分數的實體活股票（將基數穩定對齊在 ~1800 檔）
df_m = df_m.dropna(subset=["score"])
df_m = df_m.sort_values("score", ascending=False).copy()
df_m["base_rank"] = range(1, len(df_m) + 1)

market_rank = [
    build_stock_item_high_div(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"]), False)
    for sid, row in df_m.iterrows()
]
market_rank = add_history_to_items(market_rank)

# =============================================================================
# 九、Overview 績效與 Chart 歷史線條生成
# =============================================================================
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
    
    std_val = ret_series.std()
    raw_sharpe = (ret_series.mean() * 252 - 0.02) / (std_val * np.sqrt(252)) if (pd.notna(std_val) and std_val != 0) else 0
    
    return {
        "total_return": round(float(total_ret), 2) if pd.notna(total_ret) else 0.0,
        "annual_return": round(float(annual_ret), 2) if pd.notna(annual_ret) else 0.0,
        "max_drawdown": round(float(max_dd), 2) if pd.notna(max_dd) else 0.0,
        "sharpe_ratio": round(float(raw_sharpe), 2) if pd.notna(raw_sharpe) else 0.0
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

def get_pts(creturn, benchmark, start_date):
    start_date = pd.Timestamp(start_date).tz_localize(None)
    c = creturn.loc[start_date:]
    b = benchmark.loc[start_date:]
    if len(c) == 0: return []
    c = (c / c.iloc[0] - 1) * 100
    b = (b / b.iloc[0] - 1) * 100
    idx = c.index
    step = max(1, len(idx) // 300)
    keep = list(idx[::step])
    if idx[-1] not in keep: keep.append(idx[-1])
    return [
        {
            "date": str(d.date()),
            "returns": round(float(c.loc[d]), 2),
            "benchmark": round(float(b.loc[d]), 2)
        }
        for d in keep
    ]

now = pd.Timestamp(datetime.now(ZoneInfo("Asia/Taipei"))).tz_localize(None)

chart_json = {
    "今年": get_pts(report_x.creturn, report_x.benchmark, f"{now.year}-01-01"),
    "1年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=365)),
    "5年": get_pts(report_x.creturn, report_x.benchmark, now - pd.Timedelta(days=5*365)),
    "全部": get_pts(report_x.creturn, report_x.benchmark, report_x.creturn.index.min())
}

if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    latest_ytd = chart_json["今年"][-1]["returns"]
    overview["total_return_ytd"] = round(float(latest_ytd), 2)

# =============================================================================
# 十、防禦性 JSON 安全輸出
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
    "strategy_name": "高股息低波策略"
}

public_path = Path("public")
public_path.mkdir(parents=True, exist_ok=True)

with open(public_path / "chart_data_2.json", "w", encoding="utf-8") as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

# 🔒 嚴禁 NaN 流出破壞 JSON 格式
with open(public_path / "result_2.json", "w", encoding="utf-8") as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2, allow_nan=False)

print(f"✅ 完美融合與Bug修復完成！全市場共保留 {len(df_m)} 檔活體標的，現已可以順利在 GitHub Actions 上執行通關！")
