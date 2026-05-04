import { useState, useEffect } from 'react'

export default function AppSidebarLayout({ children, contentClassName = 'max-w-6xl' }) {
  // 從 localStorage 讀取狀態
  // 預設：手機版關閉、電腦版開啟
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('sidebarOpen')
    if (saved !== null) return saved === 'true'

    // 第一次使用時：手機 (寬度 < 768px) 預設關閉，電腦開啟
    return window.innerWidth >= 768
  })

  // 狀態改變時存到 localStorage
  useEffect(() => {
    localStorage.setItem('sidebarOpen', sidebarOpen)
  }, [sidebarOpen])

  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-50">
      {!sidebarOpen ? (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="fixed left-3 top-4 z-50 flex h-9 w-9 items-center justify-center rounded-r-lg rounded-l-md border border-zinc-700 bg-black text-xl font-semibold text-white shadow-sm transition hover:bg-zinc-900 md:left-4 md:top-4"
          title="開啟側邊欄"
        >
          &gt;
        </button>
      ) : null}

      <aside
        className={`
          absolute inset-y-0 left-0 z-40
          bg-black text-white h-full
          transition-all duration-300
          ${sidebarOpen ? 'w-56' : 'w-0'}
          overflow-hidden
          border-r border-zinc-200
        `}
      >
        <div className="relative flex h-full flex-col p-4">
          <div className="flex items-center justify-between gap-3 px-2 py-3">
            <div className="text-sm font-semibold tracking-tight text-white">
              量化選股策略排名
            </div>
            {sidebarOpen ? (
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-l-lg rounded-r-md border border-zinc-700 bg-zinc-700 text-lg font-semibold text-white shadow-sm transition hover:bg-zinc-600"
                title="關閉側邊欄"
              >
                &lt;
              </button>
            ) : null}
          </div>

          <nav className="mt-3 space-y-1 text-sm">
            <a
              href="/#top"
              className="block rounded-lg px-3 py-2 text-zinc-100 hover:bg-white/10"
            >
              總覽
            </a>
            <a
              href="/#meta"
              className="block rounded-lg px-3 py-2 text-zinc-100 hover:bg-white/10"
            >
              更新與聯絡
            </a>
            <a
              href="/#disclaimer"
              className="block rounded-lg px-3 py-2 text-zinc-100 hover:bg-white/10"
            >
              免責聲明
            </a>
          </nav>

          <div className="mt-auto px-2 pt-4 text-xs text-zinc-400">資料僅供研究參考</div>
        </div>
      </aside>

      <main
        className={`
          h-full overflow-y-auto
          transition-all duration-300
          ${sidebarOpen ? 'ml-56' : 'ml-0'}
        `}
      >
        <div
          className={`mx-auto w-full ${contentClassName} px-4 pt-14 pb-6 sm:px-6 sm:pt-10 sm:py-10 lg:px-8`}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
