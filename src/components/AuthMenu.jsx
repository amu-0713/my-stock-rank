import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'

function getDisplayName(user) {
  if (!user) return ''
  const meta = user.user_metadata ?? {}
  return meta.full_name || meta.name || meta.preferred_username || user.email || '使用者'
}

function getAvatarUrl(user) {
  if (!user) return null
  return user.user_metadata?.avatar_url || user.user_metadata?.picture || null
}

function getInitial(name) {
  const text = (name || '?').trim()
  return text ? text.charAt(0).toUpperCase() : '?'
}

export default function AuthMenu() {
  const { user, loading, signInWithGoogle, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined

    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [user?.id])

  const handleSignIn = async () => {
    if (busy) return
    setBusy(true)
    try {
      await signInWithGoogle()
    } catch {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    if (busy) return
    setBusy(true)
    try {
      await signOut()
      setOpen(false)
    } catch {
      // keep menu open so user can retry
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div
        className="fixed right-3 top-4 z-50 h-10 w-24 rounded-lg border border-zinc-300 bg-zinc-100 animate-pulse md:right-4"
        aria-hidden
      />
    )
  }

  if (!user) {
    return (
      <div className="fixed right-3 top-4 z-50 md:right-4">
        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-3.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:border-zinc-900 hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-wait disabled:opacity-60"
          title="使用 Google 登入（選用）"
          aria-label="使用 Google 登入（選用）"
        >
          {busy ? '登入中…' : '登入'}
        </button>
      </div>
    )
  }

  const displayName = getDisplayName(user)
  const avatarUrl = getAvatarUrl(user)
  const initial = getInitial(displayName)

  return (
    <div ref={rootRef} className="fixed right-3 top-4 z-50 md:right-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[12rem] items-center gap-2 rounded-lg border border-zinc-300 bg-white py-1.5 pl-1.5 pr-3 text-left shadow-sm transition hover:border-zinc-900 hover:bg-zinc-50 sm:max-w-[15rem]"
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white">
            {initial}
          </span>
        )}
        <span className="min-w-0 truncate text-sm font-medium text-zinc-900 max-[360px]:hidden">
          {displayName}
        </span>
        <ChevronDown
          size={16}
          className={`ml-auto shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-52 overflow-hidden rounded-lg border border-zinc-300 bg-white shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={busy}
            className="flex w-full items-center px-4 py-2.5 text-left text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 disabled:opacity-60"
          >
            {busy ? '登出中…' : '登出'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
