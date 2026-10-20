// 每年第一個資料點當作 X 軸刻度（避免同一年重複出現）；rows 需有 date 欄位（YYYY-MM-DD）
export function yearStartTicks(rows) {
  return rows.filter((r, i) => i > 0 && r.date.slice(0, 4) !== rows[i - 1].date.slice(0, 4)).map((r) => r.date)
}
