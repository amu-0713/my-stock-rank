/**
 * 平台首頁／策略選擇頁的策略入口設定。
 * 僅供路由與文案使用；排名與 result.json 邏輯仍由各策略頁處理。
 * 新增策略時在此陣列追加一筆即可。
 */
export const STRATEGY_ENTRIES = [
  {
    id: '1',
    name: '動態多因子',
    tagline: '偏成長與綜合因子排序',
    updateNote: '每日盤後',
    to: '/strategy/1',
  },
  {
    id: '2',
    name: '高息低波',
    tagline: '偏穩健與風險控制',
    updateNote: '每日盤後',
    to: '/strategy/2',
  },
]
