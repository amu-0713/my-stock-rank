# scripts/shared_backtest.py
import pandas as pd
import numpy as np
from finlab import data
from finlab.backtest import sim
from datetime import datetime

def run_full_backtest():
    print("🚀 執行完整回測 (shared_backtest)...")
    
    # ==================== 資料抓取 ====================
    price = data.get('price:收盤價').loc['2006':'2026']
    open_p = data.get('price:開盤價').loc['2006':'2026']
    pe = data.get('price_earning_ratio:本益比').loc['2006':'2026']
    rev_m = data.get('monthly_revenue:當月營收').loc['2006':'2026']
    mkt_p = price['0050']

    for df in [price, open_p, pe, rev_m]:
        df.columns = df.columns.astype(str)

    # ==================== 指標計算 ====================
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

    # ==================== 選股條件 ====================
    c_rev_positive = rev_ma3 > 0
    c_peg_range = (peg > 0.2) & (peg < 1.8)
    c_rev_high = rev_ma3 == rev_ma3.rolling(12).max()
    c_ma_ok = c_ma_filter

    # ==================== 綜合分數 ====================
    # ...（這裡我先簡化，你原本的動態權重 + RS + DD + Corr 計算可以貼進來）
    # 為了先讓結構跑起來，我先用簡單版，你之後再把你最完整的 scoring 貼進來

    score = (c_rev_positive.astype(int) * 30 +
             c_peg_range.astype(int) * 30 +
             c_rev_high.astype(int) * 20 +
             c_ma_ok.astype(int) * 20)

    # ==================== 建立 position_final ====================
    rank = score.rank(axis=1, ascending=False, pct=False)
    is_bear_mask = is_bear.reindex(rank.index).ffill()

    weight_bull = (rank <= 16).astype(int)
    weight_bear = (rank <= 5).astype(int)
    raw_position = weight_bull.where(~is_bear_mask, weight_bear).fillna(0)

    # T+1 漲停買不到處理（保留你原本的邏輯）
    limit_pct = pd.Series(0.095, index=price.index)
    limit_pct.loc[:'2015-05-31'] = 0.065
    limit_up_price_next = price.mul(1 + limit_pct, axis=0)
    cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

    prev_position = raw_position.shift(1).fillna(0)
    buy_order = raw_position > prev_position
    blocked_buy = buy_order & cannot_buy_t1

    position_final = raw_position.copy()
    position_final[blocked_buy] = prev_position[blocked_buy]

    # ==================== 執行回測 ====================
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

    print("✅ 完整回測執行完成！")
    return report, position_final, price
