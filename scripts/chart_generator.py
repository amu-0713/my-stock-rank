import os
import finlab
import pandas as pd
from pathlib import Path
from shared_backtest import run_full_backtest
import plotly.graph_objects as go

print("🚀 開始產生首頁策略績效圖表...")

# FinLab 登入
finlab_token = os.environ.get('FINLAB_TOKEN')
if finlab_token:
    finlab.login(finlab_token)
    print("✅ FinLab 登入成功")
else:
    print("⚠️ 未設定 FINLAB_TOKEN，使用本地資料")

# 確保資料夾存在
chart_dir = Path("public/charts")
chart_dir.mkdir(parents=True, exist_ok=True)

# 執行回測
report, position_final, price, score, *_ = run_full_backtest()

daily_return = report.creturn.pct_change().fillna(0)
cum_return = (1 + daily_return).cumprod() * 100 - 100
benchmark_cum = (1 + report.daily_benchmark.pct_change()).cumprod() * 100 - 100

# 產生 4 張圖
periods = {
    'ALL': cum_return.index,
    '10Y': cum_return.last('10Y').index,
    '5Y': cum_return.last('5Y').index,
    '3Y': cum_return.last('3Y').index,
}

for name, idx in periods.items():
    fig = go.Figure()
    
    # 策略線
    fig.add_trace(go.Scatter(
        x=idx, y=cum_return.loc[idx],
        mode='lines', name='動態多因子策略',
        line=dict(color='#1E40AF', width=3)
    ))
    
    # 大盤線
    fig.add_trace(go.Scatter(
        x=idx, y=benchmark_cum.loc[idx],
        mode='lines', name='0050 大盤',
        line=dict(color='#94A3B8', width=2, dash='dash')
    ))
    
    fig.update_layout(
        title=f"策略 vs 大盤績效 ({name})",
        xaxis_title="日期",
        yaxis_title="累積報酬 (%)",
        template="plotly_white",
        height=380,
        margin=dict(l=40, r=40, t=60, b=40),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1)
    )
    
    filename = f"cumulative_{name.lower()}.png"
    fig.write_image(str(chart_dir / filename), scale=3)
    print(f"✅ 已產生 {filename}")

print(f"\n🎉 所有圖表產生完成！存放在 public/charts/")
