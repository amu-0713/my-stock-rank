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

# 濾網
dy_filter = (yield_ratio < 0.9) & (yield_ratio > 0.04)
liq_filter = vol.rolling(20).mean() > 5_000_000
ma_filter = price > ma240

# 分數
dy_rank = yield_ratio.rank(axis=1, pct=True)
std_score = (1 - price.pct_change().rolling(252).std().rank(axis=1, pct=True))

raw_score = dy_rank * 0.33 + std_score * 0.67
score = raw_score.copy()
score[~(dy_filter & liq_filter & ma_filter)] = np.nan

# =============================================================================
# 二、權重與持股計算
# =============================================================================
def get_rebalance_date(dt):
    y, m = dt.year, dt.month
    if m <= 1:   return pd.Timestamp(f"{y-1}-10-31")
    elif m <= 4: return pd.Timestamp(f"{y}-01-31")
    elif m <= 7: return pd.Timestamp(f"{y}-04-30")
    elif m <= 10: return pd.Timestamp(f"{y}-07-31")
    else:        return pd.Timestamp(f"{y}-10-31")

all_dates = score.index
rebalance_dates = sorted(list(set([get_rebalance_date(d) for d in all_dates])))
rebalance_dates = [d for d in rebalance_dates if d in all_dates]

weights_list = []
for r_dt in rebalance_dates:
    row_score = score.loc[r_dt].dropna()
    top_stocks = row_score.nlargest(30).index
    
    row_is_fin = is_fin.reindex(top_stocks).fillna(False)
    fin_stocks = row_is_fin[row_is_fin].index
    non_fin_stocks = row_is_fin[~row_is_fin].index
    
    selected_fin = fin_stocks[:5]
    selected_non_fin = non_fin_stocks[:(30 - len(selected_fin))]
    final_stocks = list(selected_fin) + list(selected_non_fin)
    
    w_series = pd.Series(0.0, index=score.columns)
    if len(final_stocks) > 0:
        w_series[final_stocks] = 1.0 / len(final_stocks)
    w_series.name = r_dt
    weights_list.append(w_series)

weights_raw = pd.DataFrame(weights_list)
weights_raw = weights_raw.reindex(score.index).ffill().fillna(0)

cannot_buy_t1 = (open_p.pct_change().shift(-1) >= 0.09) | (vol == 0)
cannot_buy_t1 = cannot_buy_t1.reindex(index=weights_raw.index, columns=weights_raw.columns).fillna(False)

raw_position = (weights_raw > 0).astype(int)
prev_position = raw_position.shift(1).fillna(0).astype(int)
buy_order = raw_position > prev_position
blocked_buy = buy_order & cannot_buy_t1

position_final_x = raw_position.copy()
position_final_x[blocked_buy] = prev_position[blocked_buy]
position_final_x = position_final_x.reindex(index=price.index, columns=price.columns).fillna(0)

# =============================================================================
# 三、執行回測
# =============================================================================
report = sim(
    position_final_x.loc['2010':'2026'],
    resample='QE',
    trade_at_price='open',
    fee_ratio=0.001425,
    tax_ratio=0.003,
    position_limit=0.2,
    market='TW_STOCK',
    name='高股息低波動策略'
)

if not hasattr(report, 'benchmark') or report.benchmark is None:
    print("⚠️ 手動補充 benchmark（加權指數）")
    benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
    report.benchmark = benchmark.reindex(report.creturn.index).ffill()

print("✅ 完整回測執行完成！")

# =============================================================================
# 四、前端 JSON 排名資料生成處理
# =============================================================================
latest_dt = score.index[-1]
print(f"✅ 最新資料日期: {latest_dt.date()}")

real_rebalance_dt = get_rebalance_date(latest_dt)
print(f"✅ 本季換股基準日: {real_rebalance_dt.date()}")

current_pos = position_final_x.loc[real_rebalance_dt] if real_rebalance_dt in position_final_x.index else position_final_x.ffill().iloc[-1]
holdings = current_pos[current_pos == 1].index
print(f"✅ 目前實際持股數量: {len(holdings)} 檔")

# 公司基礎資料對照
company_info = data.get("company_basic_info").set_index("stock_id")
company_short_name_map = company_info["公司簡稱"]
company_full_name_map = company_info["公司名稱"]
industry_map = industry_map

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

# 提前將最新一天的全市場濾網切片提取出來
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
        if pd.notna(dy_val) and dy_val >= 0.9:
            fail.append("殖利率過高")
        else:
            fail.append("殖利率過低")
            
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

# 處理歷史5日分數矩陣
def add_history_to_items(items):
    if len(items) == 0: 
        return items
        
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

# 比較日與歷史排名對照
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

# --- 1. 目前持股排名 ---
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
# 脫水：防禦性剔除空值
df_f = df_f.dropna(subset=["score"])
df_f = df_f.sort_values("score", ascending=False).copy()
df_f["base_rank"] = range(1, len(df_f) + 1)

filtered_rank = [
    build_stock_item_high_div(sid, row, row["base_rank"], prev_filtered_rank_map, False, True, True)
    for sid, row in df_f.iterrows()
]
filtered_rank = add_history_to_items(filtered_rank)

# --- 3. 全市場排名 ---
df_m = pd.DataFrame({
    "score": raw_score.loc[latest_dt],
    "close": price.loc[latest_dt],
    "dy_rank": dy_rank.loc[latest_dt],
    "std_rank": std_score.loc[latest_dt],
    "passed_filter": (dy_filter & liq_filter & ma_filter).loc[latest_dt],
    "industry": industry_map.reindex(raw_score.loc[latest_dt].index)
})
# 🚀【關鍵修正】：全面砍掉下市股/未上市股的歷史殘留空值，回歸當前 ~1800 檔活體股票排名
df_m = df_m.dropna(subset=["score"])
df_m = df_m.sort_values("score", ascending=False).copy()
df_m["base_rank"] = range(1, len(df_m) + 1)

market_rank = [
    build_stock_item_high_div(sid, row, row["base_rank"], prev_market_rank_map, False, bool(row["passed_filter"]), False)
    for sid, row in df_m.iterrows()
]
market_rank = add_history_to_items(market_rank)

# =============================================================================
# 五、Overview 績效計算
# =============================================================================
daily_return = report.creturn.pct_change().fillna(0)

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

# =============================================================================
# 六、原封不動的 Chart 數據提取邏輯
# =============================================================================
def get_pts(creturn, benchmark, start_date):
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

now = datetime.now(ZoneInfo("Asia/Taipei"))
chart_json = {
    "今年": get_pts(report.creturn, report.benchmark, f"{now.year}-01-01"),
    "1年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=365)),
    "5年": get_pts(report.creturn, report.benchmark, now - pd.Timedelta(days=5*365)),
    "全部": get_pts(report.creturn, report.benchmark, report.creturn.index.min())
}

# 覆蓋 YTD 確保同步
if chart_json.get("今年") and len(chart_json["今年"]) > 0:
    latest_ytd = chart_json["今年"][-1]["returns"]
    overview["total_return_ytd"] = round(float(latest_ytd), 2)

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

with open(public_path / "chart_data_2.json", "w", encoding="utf-8") as f:
    json.dump(chart_json, f, ensure_ascii=False, indent=2)

# 🛡️ 核心守護：加入 allow_nan=False 鎖死非開源標準 JSON 符號
with open(public_path / "result_2.json", "w", encoding="utf-8") as f:
    json.dump(result_json, f, ensure_ascii=False, indent=2, allow_nan=False)

print(f"✅ 脫水處理完成！全市場有效名次共計 {len(df_m)} 檔。資料已成功安全導出！")
