import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // 逾時保護：Supabase 專案暫停／斷線時 getSession() 可能永遠不回應，
    // 5 秒後就先當作未登入，讓畫面退回正常的「登入」按鈕，而不是卡在骨架動畫。
    // 如果之後 getSession() 真的回來了，下面的 .then/.catch 還是會照常更新成正確狀態。
    const timeoutId = setTimeout(() => {
      if (!mounted) return
      console.warn('[auth] getSession timed out after 5s，暫時視為未登入')
      setSession(null)
      setUser(null)
      setLoading(false)
    }, 5000)

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.warn('[auth] getSession failed:', error.message)
        }
        setSession(data?.session ?? null)
        setUser(data?.session?.user ?? null)
      })
      .catch((err) => {
        if (!mounted) return
        console.warn('[auth] getSession error:', err)
        setSession(null)
        setUser(null)
      })
      .finally(() => {
        clearTimeout(timeoutId)
        if (!mounted) return
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setUser(nextSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    })
    if (error) {
      console.error('[auth] Google sign-in failed:', error.message)
      throw error
    }
  }, [])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[auth] signOut failed:', error.message)
      throw error
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signInWithGoogle,
      signOut,
    }),
    [user, session, loading, signInWithGoogle, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
