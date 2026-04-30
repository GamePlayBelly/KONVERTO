import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Mail, RefreshCw, CheckCircle2, Leaf, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const OTP_LENGTH = 8

export default function VerifyEmail() {
  const navigate = useNavigate()
  const { verifyOtp, resendOtp } = useAuth()

  // Email might come from sessionStorage (set by Signup) or user can type it
  const [email, setEmail] = useState(() => sessionStorage.getItem('verifyEmail') ?? '')
  const [emailConfirmed, setEmailConfirmed] = useState(() => !!sessionStorage.getItem('verifyEmail'))

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(0) // starts at 0 so user can immediately request a code
  const [codeSent, setCodeSent] = useState(false)
  const [otpExpiry, setOtpExpiry] = useState(0) // countdown for OTP validity (60s)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // Countdown for resend button
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  // Countdown for OTP validity (60 seconds)
  useEffect(() => {
    if (otpExpiry <= 0) return
    const t = setTimeout(() => setOtpExpiry((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [otpExpiry])

  // Focus first OTP box when email is confirmed
  useEffect(() => {
    if (emailConfirmed) {
      setTimeout(() => inputRefs.current[0]?.focus(), 100)
    }
  }, [emailConfirmed])

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)
    setError('')
    if (value && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus()
    if (newOtp.every((d) => d !== '') && newOtp.filter((d) => d).length === OTP_LENGTH) {
      submitOtp(newOtp.join(''))
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    const newOtp = Array(OTP_LENGTH).fill('')
    pasted.split('').forEach((d, i) => { newOtp[i] = d })
    setOtp(newOtp)
    if (pasted.length === OTP_LENGTH) submitOtp(pasted)
  }

  const submitOtp = async (code: string) => {
    setLoading(true)
    setError('')
    try {
      await verifyOtp(email, code)
      sessionStorage.removeItem('verifyEmail')
      setSuccess(true)
      setTimeout(() => navigate('/dashboard'), 1500)
    } catch {
      setError('Codice non valido o scaduto. Controlla l\'email e riprova.')
      setOtp(Array(OTP_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email || countdown > 0) return
    setResending(true)
    try {
      await resendOtp(email)
      setCountdown(30)
      setCodeSent(true)
      setOtpExpiry(60) // OTP valid for 60 seconds
      setError('')
      setOtp(Array(OTP_LENGTH).fill(''))
      setTimeout(() => inputRefs.current[0]?.focus(), 50)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      const lower = msg.toLowerCase()
      if (lower.includes('sending confirmation') || lower.includes('smtp') || lower.includes('error sending')) {
        setError('Invio email fallito (SMTP non configurato). Controlla le impostazioni Brevo in Supabase → Authentication → SMTP Settings.')
      } else if (lower.includes('rate limit') || lower.includes('too many')) {
        setError('Troppe richieste. Attendi qualche minuto prima di reinviare.')
      } else if (lower.includes('user not found') || lower.includes('no user')) {
        setError('Nessun account trovato con questa email. Torna alla registrazione.')
      } else {
        setError('Impossibile inviare il codice. Riprova tra poco.')
      }
    } finally {
      setResending(false)
    }
  }

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    sessionStorage.setItem('verifyEmail', email.trim())
    setEmailConfirmed(true)
    setCountdown(0)
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
          <h1 className="text-2xl font-bold text-gray-900">Verifica la tua email</h1>
          <p className="text-gray-500 mt-1">Inserisci il codice a 8 cifre ricevuto</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {success ? (
            <div className="py-6 flex flex-col items-center gap-4 text-center">
              <CheckCircle2 className="w-16 h-16 text-eco-green" />
              <p className="text-xl font-semibold text-gray-900">Email verificata!</p>
              <p className="text-gray-500">Accesso in corso...</p>
            </div>

          ) : !emailConfirmed ? (
            /* ── Step 1: chiedi l'email se non ce l'abbiamo ── */
            <form onSubmit={handleEmailSubmit} className="space-y-5">
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-2">
                <Mail className="w-7 h-7 text-blue-500" />
              </div>
              <p className="text-sm text-gray-600 text-center">
                Inserisci l'indirizzo email con cui ti sei registrato per ricevere o verificare il codice a 8 cifre.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="verify-email">La tua email</Label>
                <Input
                  id="verify-email"
                  type="email"
                  placeholder="mario@esempio.it"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError('') }}
                  autoFocus
                  autoComplete="email"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>
              )}
              <Button type="submit" className="w-full" size="lg" disabled={!email.trim()}>
                Continua
              </Button>
              <p className="text-center text-sm text-gray-500">
                <Link to="/login" className="text-eco-green font-semibold hover:underline flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Torna al login
                </Link>
              </p>
            </form>

          ) : (
            /* ── Step 2: inserisci il codice OTP ── */
            <>
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Mail className="w-7 h-7 text-blue-500" />
              </div>
              <p className="text-gray-600 mb-1 text-center text-sm">Abbiamo inviato un'email a</p>
              <p className="font-semibold text-gray-900 mb-1 text-center break-all">{email}</p>
              <button
                type="button"
                onClick={() => { setEmailConfirmed(false); setError(''); setOtp(Array(OTP_LENGTH).fill('')) }}
                className="text-xs text-eco-green hover:underline mx-auto block mb-3"
              >
                ← Cambia email
              </button>
              {!codeSent ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 text-xs text-amber-800 text-left space-y-2">
                  <p className="font-semibold">⚠️ L'email di registrazione contiene un link, non un codice numerico.</p>
                  <p>Hai due opzioni:</p>
                  <p>• <strong>Clicca il bottone/link nell'email</strong> → accedi automaticamente senza inserire nulla qui</p>
                  <p>• <strong>Oppure clicca "Invia codice numerico"</strong> qui sotto → ricevi un'email separata con il codice a 6 cifre da inserire</p>
                </div>
              ) : (
                <div className={`rounded-xl p-3 mb-4 text-xs text-left border transition-colors ${
                  otpExpiry > 10
                    ? 'bg-eco-green-light border-eco-green/20 text-eco-teal'
                    : otpExpiry > 0
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  {otpExpiry > 0 ? (
                    <>
                      ✅ <strong>Codice inviato!</strong> Inserisci le 6 cifre qui sotto.{' '}
                      <span className="font-bold">
                        Scade in {otpExpiry}s {otpExpiry <= 10 ? '⚠️' : ''}
                      </span>
                    </>
                  ) : (
                    <>⏰ <strong>Codice scaduto.</strong> Clicca "Reinvia codice numerico" per riceverne uno nuovo.</>
                  )}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-4" role="alert">
                  {error}
                </div>
              )}

              {/* OTP boxes */}
              <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    disabled={loading}
                    aria-label={`Cifra ${i + 1} del codice OTP`}
                    className="w-11 h-14 text-center text-xl font-bold border-2 border-gray-200 rounded-xl focus:border-eco-green focus:outline-none focus:ring-2 focus:ring-eco-green/20 transition-all disabled:opacity-50 bg-white"
                  />
                ))}
              </div>

              <Button
                className="w-full mb-4"
                size="lg"
                onClick={() => submitOtp(otp.join(''))}
                disabled={loading || otp.some((d) => !d)}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Verifica...
                  </span>
                ) : 'Verifica codice'}
              </Button>

              {/* Resend / send numeric code */}
              <div className="text-center">
                <button
                  onClick={handleResend}
                  disabled={countdown > 0 || resending}
                  className="inline-flex items-center gap-2 text-sm font-semibold bg-eco-green-light text-eco-teal hover:bg-green-100 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded-xl border border-eco-green/20 transition-colors"
                >
                  {resending
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Invio in corso...</>
                    : countdown > 0
                      ? `⏳ Reinvia tra ${countdown}s`
                      : codeSent
                        ? <><RefreshCw className="w-3.5 h-3.5" /> Reinvia codice numerico</>
                        : '📨 Invia codice numerico'}
                </button>
                <p className="text-xs text-gray-400 mt-1.5">
                  {codeSent ? 'Non ricevi nulla? Controlla spam o riprova.' : 'Ricevi un\'email con il codice a 6 cifre da inserire sopra'}
                </p>
              </div>

              <p className="text-center text-sm text-gray-400 mt-4">
                <Link to="/login" className="hover:text-eco-green transition-colors flex items-center justify-center gap-1">
                  <ArrowLeft className="w-3.5 h-3.5" /> Torna al login
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
