# scripts/shared_backtest.py
import pandas as pd
import numpy as np
from finlab import data
from finlab.backtest import sim

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

    # 計算 full_score_matrix（用於歷史分數）
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

    # ✅ 新增：明確設定 benchmark（確保 chart_data.json 能用到）
    if not hasattr(report, 'benchmark') or report.benchmark is None:
        print("⚠️ 手動補充 benchmark（加權指數）")
        benchmark = data.get('benchmark_return:發行量加權股價報酬指數').squeeze()
        report.benchmark = benchmark.reindex(report.creturn.index).ffill()

    print("✅ 完整回測執行完成！")
    
    # ====================== 回傳所有需要的值 ======================
    return (
        report, 
        position_final, 
        price, 
        score, 
        final_cond, 
        rs_fixed, 
        peg, 
        dd, 
        corr_mkt, 
        regime, 
        weights, 
        full_score_matrix,
        c_rev_positive, 
        c_rev_high, 
        c_hist, 
        c_ma_filter, 
        c_liq
    )
# ====================== 新增：高股息低波動策略（完全獨立函數） ======================
def run_high_div_low_vol():
    print("🚀 執行 高股息低波動策略 (shared_backtest)...")

    # ====================== 資料載入 ======================
    price = data.get('price:收盤價')
    open_p = data.get('price:開盤價')
    yield_ratio = data.get('price_earning_ratio:殖利率(%)') / 100
    vol = data.get('price:成交金額')
    info = data.get('company_basic_info')

    industry_map = info.set_index('stock_id')['產業類別'].astype(str)
    is_fin = industry_map.str.contains('金融').fillna(False)

    for df in [price, open_p, yield_ratio, vol]:
        df.columns = df.columns.astype(str)

    # ====================== 因子計算 ======================
    ma240 = price.rolling(240).mean()
    liq_filter = vol.rank(axis=1, pct=True) > 0.5
    ma_filter = price > ma240
    std240 = price.ffill().pct_change(fill_method=None).rolling(240).std()

    dy_rank = yield_ratio.rank(axis=1, pct=True)
    dy_filter = (dy_rank > 0.6) & (dy_rank < 0.9)

    std_score = std240.rank(axis=1, pct=True, ascending=False)
    dy_score = dy_rank
    score = dy_score * 0.33 + std_score * 0.67

    final_filter = dy_filter & liq_filter & ma_filter
    score = score.where(final_filter)

    # ====================== 選股邏輯 ======================
    max_holdings = 12
    max_financial = 4
    candidate_n = 25

    raw_position = pd.DataFrame(0, index=score.index, columns=score.columns, dtype=int)

    for dt in score.index:
        s = score.loc[dt].dropna().sort_values(ascending=False).head(candidate_n)
        
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

    # ====================== 漲停買不到處理 ======================
    limit_pct = pd.Series(0.095, index=price.index)
    limit_pct.loc[:'2015-05-31'] = 0.065
    limit_up_price_next = price.mul(1 + limit_pct, axis=0)
    cannot_buy_t1 = open_p.shift(-1) >= limit_up_price_next

    target_pos_qe = raw_position.resample('QE-JAN').last()
    prev_target_pos_qe = target_pos_qe.shift(1).fillna(0)
    prev_position = prev_target_pos_qe.reindex(raw_position.index).ffill().fillna(0)

    buy_order = raw_position > prev_position
    position_final = raw_position.copy()
    blocked_buy = (buy_order & cannot_buy_t1).fillna(False)
    position_final[blocked_buy] = prev_position[blocked_buy]

    # ====================== 回測 ======================
    report = sim(
        position_final,
        resample='QE-JAN',
        trade_at_price='open',
        fee_ratio=0.001425,
        tax_ratio=0.003,
        name='高股息低波動策略',
        live_performance_start='2025-12-30',
        upload=True
    )

    print("✅ 高股息低波動策略 回測完成")
    report.display()

    return report, position_final, score, industry_map, dy_rank, std_score
