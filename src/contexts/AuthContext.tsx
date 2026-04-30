import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase, getProfile } from '@/lib/supabase'
import type { Profile } from '@/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  signUp: (email: string, password: string, username: string, fullName: string) => Promise<{ needsConfirmation: boolean }>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  verifyOtp: (email: string, token: string) => Promise<void>
  resendOtp: (email: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  updatePassword: (newPassword: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    const p = await getProfile(userId)
    setProfile(p)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) loadProfile(s.user.id).finally(() => setLoading(false))
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) loadProfile(s.user.id)
      else setProfile(null)
      // When the user clicks the magic link in the email, Supabase fires SIGNED_IN
      // with a confirmed user — clear the sessionStorage flag
      if (event === 'SIGNED_IN' && s?.user?.email_confirmed_at) {
        sessionStorage.removeItem('verifyEmail')
      }
    })

    return () => subscription.unsubscribe()
  }, [loadProfile])

  const signUp = async (email: string, password: string, username: string, fullName: string): Promise<{ needsConfirmation: boolean }> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, full_name: fullName },
      },
    })
    if (error) throw error
    // session is null when Supabase requires email confirmation
    return { needsConfirmation: !data.session }
  }

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  const verifyOtp = async (email: string, token: string) => {
    // 'email' type = codes sent via signInWithOtp (our resend flow)
    const { error: err1 } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (!err1) return
    // Fallback: 'signup' type (original signup confirmation email)
    const { error: err2 } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })
    if (err2) throw err2
  }

  const resendOtp = async (email: string) => {
    // signInWithOtp sends a proper 6-digit numeric code — more reliable than resend({ type: 'signup' })
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } })
    if (error) throw error
  }

  const forgotPassword = async (email: string) => {
    const redirectTo = `${window.location.origin}/reset-password`
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error) throw error
  }

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }

  const refreshProfile = async () => {
    if (user) await loadProfile(user.id)
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, signUp, signIn, signOut, verifyOtp, resendOtp, forgotPassword, updatePassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
