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
    # 四、多因子評分系統 (核心修正：用 Pandas 的 index/columns 自動對齊化解維度衝突)
    # =============================================================================
    rs_fixed = price.ffill().pct_change(80, fill_method=None)
    rets = price.pct_change(fill_method=None)
    mkt_rets = mkt_p.pct_change(fill_method=None)

    dd = rets.where(rets < 0, 0).rolling(20).std().replace(0, np.nan)
    corr_mkt = rets.rolling(60).corr(mkt_rets)

    # 基礎百分比大排名
    r_rs = rs_fixed.where(final_cond).rank(axis=1, pct=True)
    r_peg = (1 / peg).where(final_cond).rank(axis=1, pct=True)
    r_dd = (-dd).where(final_cond).rank(axis=1, pct=True)
    c_corr = final_cond & (corr_mkt < 0.5)
    r_corr = (-corr_mkt).where(c_corr).rank(axis=1, pct=True)

    is_bear_mask = is_bear.reindex(r_rs.index).ffill().fillna(True)
    regime = pd.Series(np.where(is_bear_mask, 'bear', 'bull'), index=r_rs.index)

    # 基礎多頭與空頭市場因子權重
    weights = pd.DataFrame({
        'rs':   {'bull': 0.3, 'bear': 0.3},
        'peg':  {'bull': 0.3, 'bear': 0.0},
        'corr': {'bull': 0.0, 'bear': 0.3},
        'dd':   {'bull': 0.4, 'bear': 0.4},
    })

    # 轉換為帶有日期 Index 的 Series
    w_rs_dyn = regime.map(weights['rs'])
    w_peg_dyn = regime.map(weights['peg'])
    w_corr_dyn = regime.map(weights['corr'])
    w_dd_dyn = regime.map(weights['dd'])

    # 🛠️ 關鍵修正 1：判定 PEG 缺值狀況，並利用 reindex 確保時間軸與個股代號完全對齊
    is_peg_nan = (peg.isnull() | (peg < 0)).reindex(index=r_rs.index, columns=r_rs.columns).fillna(True)

    # 計算剩餘三個活躍因子的權重總和 Series (維度：時間軸)
    total_active_w = w_rs_dyn + w_corr_dyn + w_dd_dyn

    # 當 peg 缺值時，計算其餘因子分配的乘數 Series (維度：時間軸)
    scale_factor = 1 + w_peg_dyn / total_active_w.replace(0, np.nan)
    scale_factor = scale_factor.fillna(1.0)

    # 🛠️ 關鍵修正 2：利用 Pandas 廣播機制（軸向對齊）建立最終權重 Dataframe
    # 先讓全矩陣填滿原始權重，再將 is_peg_nan 為 True 的格子乘以 scale_factor
    w_rs_final = pd.DataFrame(w_rs_dyn.values[:, None], index=r_rs.index, columns=r_rs.columns)
    w_corr_final = pd.DataFrame(w_corr_dyn.values[:, None], index=r_rs.index, columns=r_rs.columns)
    w_dd_final = pd.DataFrame(w_dd_dyn.values[:, None], index=r_rs.index, columns=r_rs.columns)
    
    # 針對缺值個股動態放大權重
    w_rs_final[is_peg_nan] = w_rs_final[is_peg_nan].mul(scale_factor, axis=0)
    w_corr_final[is_peg_nan] = w_corr_final[is_peg_nan].mul(scale_factor, axis=0)
    w_dd_final[is_peg_nan] = w_dd_final[is_peg_nan].mul(scale_factor, axis=0)

    # PEG 權重在缺值時直接歸零
    w_peg_final = pd.DataFrame(w_peg_dyn.values[:, None], index=r_rs.index, columns=r_rs.columns)
    w_peg_final[is_peg_nan] = 0.0

    # 最終加權算分 (策略選股與回測用)
    score = (
        r_rs.mul(w_rs_final).fillna(0) +
        r_peg.mul(w_peg_final).fillna(0) +
        r_corr.mul(w_corr_final).fillna(0) +
        r_dd.mul(w_dd_final).fillna(0)
    )

    # 計算 full_score_matrix（用於歷史大排名，基底相同，完美對齊）
    r_rs_all = rs_fixed.rank(axis=1, pct=True)
    r_peg_all = (1 / peg).rank(axis=1, pct=True)
    r_dd_all = (-dd).rank(axis=1, pct=True)
    r_corr_all = (-corr_mkt).rank(axis=1, pct=True)

    full_score_matrix = (
        r_rs_all.mul(w_rs_final).fillna(0) +
        r_peg_all.mul(w_peg_final).fillna(0) +
        r_corr_all.mul(w_corr_final).fillna(0) +
        r_dd_all.mul(w_dd_final).fillna(0)
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

    # ✅ 明確設定 benchmark（確保 chart_data.json 能用到）
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
