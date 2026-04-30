import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Leaf, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ResetPassword() {
  const navigate = useNavigate()
  const { updatePassword } = useAuth()

  const [ready, setReady] = useState(false)       // session from reset link is active
  const [invalid, setInvalid] = useState(false)   // link expired / invalid
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset link.
  // detectSessionInUrl:true + flowType:'implicit' sets the session from the URL hash.
  useEffect(() => {
    // Check if there's already a recovery session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
      else setInvalid(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
      if (event === 'SIGNED_IN') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('La password deve essere di almeno 8 caratteri'); return }
    if (password !== confirm) { setError('Le password non corrispondono'); return }
    setLoading(true)
    setError('')
    try {
      await updatePassword(password)
      setDone(true)
      setTimeout(() => navigate('/dashboard'), 2000)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const lower = msg.toLowerCase()
      if (lower.includes('same password') || lower.includes('different from')) {
        setError('La nuova password deve essere diversa da quella precedente.')
      } else if (lower.includes('weak') || lower.includes('too short')) {
        setError('Password troppo debole. Usa almeno 8 caratteri con lettere e numeri.')
      } else {
        setError(msg || 'Errore durante il cambio password. Riprova.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-eco-green-light via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link to="/">
            <div className="w-14 h-14 bg-eco-green rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-eco-green/25 hover:shadow-xl transition-shadow">
              <Leaf className="w-8 h-8 text-white" />
            </div>
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Nuova password</h1>
          <p className="text-gray-500 mt-1">Scegli una nuova password sicura</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

          {/* Link expired */}
          {invalid && !ready && (
            <div className="text-center space-y-4 py-2">
              <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto">
                <AlertTriangle className="w-7 h-7 text-red-500" />
              </div>
              <p className="font-semibold text-gray-900">Link scaduto o non valido</p>
              <p className="text-sm text-gray-500">
                Il link di recupero è scaduto. Richiedine uno nuovo.
              </p>
              <Link to="/forgot-password">
                <Button className="w-full">Richiedi nuovo link</Button>
              </Link>
            </div>
          )}

          {/* Success */}
          {done && (
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-eco-green-light rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-eco-green" />
              </div>
              <p className="text-lg font-bold text-gray-900">Password aggiornata!</p>
              <p className="text-sm text-gray-500">Reindirizzamento in corso...</p>
            </div>
          )}

          {/* Form */}
          {ready && !done && (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="password">Nuova password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="password"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Minimo 8 caratteri"
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError('') }}
                    className="pl-10 pr-10"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label={showPwd ? 'Nascondi password' : 'Mostra password'}
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Conferma password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="confirm"
                    type={showPwd ? 'text' : 'password'}
                    placeholder="Ripeti la password"
                    value={confirm}
                    onChange={e => { setConfirm(e.target.value); setError('') }}
                    className="pl-10"
                  />
                </div>
                {confirm && password !== confirm && (
                  <p className="text-xs text-red-500">Le password non corrispondono</p>
                )}
              </div>

              {/* Password strength indicator */}
              {password.length > 0 && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${
                        password.length >= i * 3
                          ? i <= 1 ? 'bg-red-400' : i <= 2 ? 'bg-amber-400' : i <= 3 ? 'bg-yellow-400' : 'bg-eco-green'
                          : 'bg-gray-200'
                      }`} />
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">
                    {password.length < 8 ? 'Troppo corta' : password.length < 10 ? 'Accettabile' : password.length < 12 ? 'Buona' : 'Ottima ✓'}
                  </p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading || !password || !confirm || password !== confirm || password.length < 8}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Salvataggio...
                  </span>
                ) : (
                  <><Lock className="w-4 h-4" /> Imposta nuova password</>
                )}
              </Button>
            </form>
          )}

          {/* Loading state while session establishes */}
          {!ready && !invalid && !done && (
            <div className="flex items-center justify-center py-8 gap-3 text-gray-400">
              <span className="w-5 h-5 border-2 border-eco-green border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Verifica del link in corso...</span>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
