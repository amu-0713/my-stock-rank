# scripts/chart_generator.py
import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from pathlib import Path
from shared_backtest import run_full_backtest

print("🚀 開始產生首頁圖表...")

# 確保資料夾存在
chart_dir = Path("public/charts")
chart_dir.mkdir(parents=True, exist_ok=True)

# 執行完整回測（共用）
report, position_final, price, score = run_full_backtest()

daily_return = report.creturn.pct_change().fillna(0)
cum_return = (1 + daily_return).cumprod()

# ====================== 1. 累積報酬曲線 ======================
fig1 = go.Figure()
fig1.add_trace(go.Scatter(
    x=cum_return.index, 
    y=cum_return*100 - 100,
    mode='lines', 
    name='動態多因子策略',
    line=dict(color='#1E40AF', width=3)
))
fig1.add_trace(go.Scatter(
    x=cum_return.index, 
    y=(1 + report.daily_benchmark.pct_change()).cumprod()*100 - 100,
    mode='lines', 
    name='0050 指數',
    line=dict(color='#94A3B8', width=2, dash='dash')
))
fig1.update_layout(
    title="策略累積報酬曲線 (2010 年至今)",
    xaxis_title="日期",
    yaxis_title="累積報酬 (%)",
    template="plotly_white",
    height=520
)
fig1.write_image(str(chart_dir / "cumulative_return.png"), scale=3)
print("✅ cumulative_return.png 已儲存")

# ====================== 2. 年度報酬熱力圖 ======================
yearly = (daily_return.resample('YE').sum() * 100).round(1)
fig2 = px.imshow([yearly.values],
                 labels=dict(x="年度", color="報酬率 (%)"),
                 color_continuous_scale='RdYlGn',
                 text_auto=True)
fig2.update_layout(title="年度報酬熱力圖", height=280)
fig2.write_image(str(chart_dir / "annual_heatmap.png"), scale=3)
print("✅ annual_heatmap.png 已儲存")

# ====================== 3. 滾動報酬 ======================
rolling_1y = daily_return.rolling(252).sum() * 100
rolling_3y = daily_return.rolling(756).sum() * 100

fig3 = go.Figure()
fig3.add_trace(go.Scatter(x=rolling_1y.index, y=rolling_1y, name="1年滾動報酬", line=dict(color="#1E40AF")))
fig3.add_trace(go.Scatter(x=rolling_3y.index, y=rolling_3y, name="3年滾動報酬", line=dict(color="#3B82F6")))
fig3.update_layout(title="滾動報酬走勢 (1年 / 3年)", height=480)
fig3.write_image(str(chart_dir / "rolling_return.png"), scale=3)
print("✅ rolling_return.png 已儲存")

print(f"\n🎉 所有圖表產生完成！存放在 public/charts/")
