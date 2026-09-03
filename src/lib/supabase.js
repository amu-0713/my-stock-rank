import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Auth will not work until env is set.',
  )
}

// createClient() 丟空字串會在模組載入當下直接 throw（supabaseUrl is required），
// 這會讓整個 import 鏈（main.jsx → AuthContext → 這裡）在 React 還沒開始渲染前就掛掉，
// 造成整頁白屏且沒有任何畫面可看。用一個合法但不會真的用到的預設值墊著，
// 讓 App 一定能正常渲染，登入功能本身則會因為連不上這個假網址而自然地失敗（已由
// AuthContext 的逾時保護與 try/catch 接住，退回未登入狀態，不影響其他功能）。
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-anon-key',
)
