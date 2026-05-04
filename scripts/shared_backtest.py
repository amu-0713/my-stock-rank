# scripts/shared_backtest.py
import pandas as pd
import numpy as np
from finlab import data
from finlab.backtest import sim
from datetime import datetime

def run_full_backtest():
    print("🚀 執行完整回測 (shared_backtest.py)...")

    # =============================================================================
    # 一、資料抓取與基礎指標計算
    # =============================================================================
    price  = data.get('price:收盤價').loc['2006':'2026']
    open_p = data.get('price:開盤價').loc['2006':'2026']
    pe     = data.get('price_earning_ratio:本益比').loc['2006':'2026']
    rev_m  = data.get('monthly_revenue:當月營收').loc['2006':'2026']
    vol    = data.get('price:成交金額').loc['2006':'2026']

    mkt_p = price['0050']

    for df in [price, open_p, pe, rev_m, vol]:
        df.columns = df.columns.astype(str)

    # 均線
    ma20  = price.rolling(20).mean()
    ma60  = price.rolling(60).mean()
    ma120 = price.rolling(120).mean()
    mkt_30 = mkt_p.rolling(30).mean()
    mkt_60 = mkt_p.rolling(60).mean()

    # =============================================================================
    # 二、大盤狀態與均線濾網
    # =============================================================================
    is_bear = mkt_30 < mkt_60
    c_ma_filter = (ma20 > ma60) & (ma60 > ma120)

    # =============================================================================
    # 三、選股過濾條件
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
    # 四、多因子評分系統（你完整的動態權重）
    # =============================================================================
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
        'rs':   {'bull': 0.3, 'bear': 0.3},
        'peg':  {'bull': 0.3, 'bear': 0.0},
        'corr': {'bull': 0.0, 'bear': 0.3},
        'dd':   {'bull': 0.4, 'bear': 0.4},
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

    # =============================================================================
    # 五、持股權重 + T+1 處理 + position_final
    # =============================================================================
    N_BULL, N_BEAR = 16, 5
    score_ranks = score.rank(axis=1, ascending=False)

    bull_mask = score_ranks <= N_BULL
    bear_mask = score_ranks <= N_BEAR

    weight_bull = bull_mask.div(bull_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
    weight_bear = bear_mask.div(bear_mask.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)

    raw_position = weight_bull.where(~is_bear_mask, weight_bear).fillna(0)

    # T+1 漲停處理
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

    print("✅ 完整回測執行完成！")
    return report, position_final, price, score
