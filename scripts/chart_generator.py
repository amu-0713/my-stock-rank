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

