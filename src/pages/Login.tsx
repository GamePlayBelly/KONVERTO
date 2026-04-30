import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Leaf, Mail, Lock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function Login() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) { setError('Inserisci email e password'); return }
    setLoading(true)
    setError('')
    try {
      await signIn(email, password)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore di accesso'
      const lower = msg.toLowerCase()
      if (lower.includes('invalid login') || lower.includes('invalid credentials') || lower.includes('invalid email or password')) {
        setError('Email o password non corretti.')
      } else if (lower.includes('email not confirmed') || lower.includes('confirm')) {
        // Account exists but email not verified yet — go verify
        sessionStorage.setItem('verifyEmail', email)
        navigate('/verify-email')
      } else if (lower.includes('too many') || lower.includes('rate limit')) {
        setError('Troppi tentativi. Aspetta qualche minuto e riprova.')
      } else if (lower.includes('network') || lower.includes('fetch')) {
        setError('Errore di connessione. Controlla internet e riprova.')
      } else {
        setError(msg || 'Errore durante l\'accesso. Riprova.')
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
          <h1 className="text-2xl font-bold text-gray-900">Bentornato</h1>
          <p className="text-gray-500 mt-1">Accedi al tuo account EcoTrack</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-6" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="mario@esempio.it"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError('') }}
                  className="pl-10"
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="La tua password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError('') }}
                  className="pl-10 pr-10"
                  autoComplete="current-password"
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

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Accesso...
                </span>
              ) : (
                'Accedi'
              )}
            </Button>
          </form>

          <div className="mt-6 space-y-3 text-center text-sm text-gray-500">
            <p>
              <Link to="/forgot-password" className="text-gray-400 hover:text-eco-green hover:underline transition-colors">
                Hai dimenticato la password?
              </Link>
            </p>
            <p>
              Non hai un account?{' '}
              <Link to="/signup" className="text-eco-green font-semibold hover:underline">
                Registrati gratis
              </Link>
            </p>
            <p>
              Hai ricevuto un codice via email?{' '}
              <Link to="/verify-email" className="text-eco-green font-semibold hover:underline">
                Verifica account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
