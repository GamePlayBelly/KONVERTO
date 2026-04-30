import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Leaf, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPassword() {
  const { forgotPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) { setError('Inserisci la tua email'); return }
    setLoading(true)
    setError('')
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const lower = msg.toLowerCase()
      if (lower.includes('rate limit') || lower.includes('too many')) {
        setError('Troppe richieste. Aspetta qualche minuto e riprova.')
      } else if (lower.includes('user not found') || lower.includes('invalid email')) {
        // Don't reveal if email exists — show success anyway for security
        setSent(true)
      } else {
        setError(msg || 'Errore nell\'invio. Riprova.')
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
          <h1 className="text-2xl font-bold text-gray-900">Recupera password</h1>
          <p className="text-gray-500 mt-1">Ti mandiamo un link per reimpostare la password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {sent ? (
            /* ── Success state ── */
            <div className="text-center space-y-4 py-4">
              <div className="w-16 h-16 bg-eco-green-light rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-eco-green" />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">Email inviata!</p>
                <p className="text-sm text-gray-500 mt-1">
                  Controlla la casella di <strong>{email}</strong>.
                  Troverai un link per reimpostare la password.
                </p>
                <p className="text-xs text-gray-400 mt-2">Non trovi nulla? Controlla anche la cartella spam.</p>
              </div>
              <Link to="/login">
                <Button variant="outline" className="w-full mt-2">
                  <ArrowLeft className="w-4 h-4" /> Torna al login
                </Button>
              </Link>
            </div>
          ) : (
            /* ── Form ── */
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm">
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">La tua email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="mario@esempio.it"
                    value={email}
                    onChange={e => { setEmail(e.target.value); setError('') }}
                    className="pl-10"
                    autoFocus
                    autoComplete="email"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading || !email.trim()}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Invio in corso...
                  </span>
                ) : (
                  'Invia link di recupero'
                )}
              </Button>

              <p className="text-center text-sm text-gray-500">
                <Link to="/login" className="text-eco-green font-semibold hover:underline flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Torna al login
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
