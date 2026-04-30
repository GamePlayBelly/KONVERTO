import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Leaf, User, Mail, Lock, UserCheck, AlertTriangle } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface FormState {
  username: string
  fullName: string
  email: string
  password: string
  confirmPassword: string
}

interface FormErrors {
  username?: string
  fullName?: string
  email?: string
  password?: string
  confirmPassword?: string
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.username.trim()) errors.username = 'Username obbligatorio'
  else if (form.username.length < 3) errors.username = 'Minimo 3 caratteri'
  else if (!/^[a-z0-9_]+$/i.test(form.username)) errors.username = 'Solo lettere, numeri e underscore'
  if (!form.fullName.trim()) errors.fullName = 'Nome obbligatorio'
  if (!form.email.trim()) errors.email = 'Email obbligatoria'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errors.email = 'Email non valida'
  if (!form.password) errors.password = 'Password obbligatoria'
  else if (form.password.length < 8) errors.password = 'Minimo 8 caratteri'
  if (form.confirmPassword !== form.password) errors.confirmPassword = 'Le password non corrispondono'
  return errors
}

export default function Signup() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [form, setForm] = useState<FormState>({
    username: '', fullName: '', email: '', password: '', confirmPassword: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState('')

  const update = (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    setApiError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs = validate(form)
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      const { needsConfirmation } = await signUp(form.email, form.password, form.username.toLowerCase(), form.fullName)
      if (needsConfirmation) {
        // Store email so VerifyEmail page can pre-fill it
        sessionStorage.setItem('verifyEmail', form.email)
        navigate('/verify-email')
      } else {
        // Email confirmation disabled in Supabase — already logged in
        navigate('/dashboard')
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err)
      const lower = raw.toLowerCase()
      if (lower.includes('rate limit')) {
        sessionStorage.setItem('verifyEmail', form.email)
        setApiError('__rate_limit__')
      } else if (
        lower.includes('sending confirmation email') ||
        lower.includes('smtp') ||
        lower.includes('email provider') ||
        lower.includes('error sending')
      ) {
        // Account WAS created in Supabase but the SMTP server couldn't send the email.
        // Save email so VerifyEmail can prefill it; user can try resend once SMTP is fixed.
        sessionStorage.setItem('verifyEmail', form.email)
        setApiError('__smtp_error__')
      } else if (
        lower.includes('already registered') ||
        lower.includes('already exists') ||
        lower.includes('user already')
      ) {
        // Account exists but might be unconfirmed — offer to go verify rather than just "try login"
        sessionStorage.setItem('verifyEmail', form.email)
        setApiError('__already_registered__')
      } else if (lower.includes('invalid email') || lower.includes('unable to validate')) {
        setApiError('Indirizzo email non valido.')
      } else if (lower.includes('password') && lower.includes('short')) {
        setApiError('La password è troppo corta. Minimo 8 caratteri.')
      } else {
        setApiError(raw || 'Errore durante la registrazione. Riprova.')
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
          <div className="w-14 h-14 bg-eco-green rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-eco-green/25">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Crea il tuo account</h1>
          <p className="text-gray-500 mt-1">Inizia a tracciare la tua mobilità sostenibile</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {/* Generic error */}
          {apiError && !['__rate_limit__', '__smtp_error__', '__already_registered__'].includes(apiError) && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-sm mb-6">
              {apiError}
            </div>
          )}

          {/* Rate-limit error */}
          {apiError === '__rate_limit__' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-amber-800">Troppe email inviate</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Supabase limita l'invio email. Se hai già ricevuto un codice in precedenza, puoi ancora usarlo.
                  </p>
                </div>
              </div>
              <Link to="/verify-email">
                <button className="w-full text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg px-3 py-2 transition-colors mt-1">
                  Hai già il codice? → Verifica email
                </button>
              </Link>
            </div>
          )}

          {/* SMTP / email-sending error */}
          {apiError === '__smtp_error__' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-red-800">Account creato, invio email fallito</p>
                  <p className="text-xs text-red-700 mt-1">
                    Il tuo account <strong>è stato creato</strong> ma la email di conferma non è partita
                    (problema SMTP/Brevo). Puoi:
                  </p>
                  <ul className="text-xs text-red-700 mt-1 space-y-0.5 list-disc list-inside">
                    <li>Provare a reinviare il codice dalla pagina successiva</li>
                    <li>Oppure disabilita <em>Confirm email</em> in <strong>Supabase → Auth → Email</strong> per i test</li>
                  </ul>
                </div>
              </div>
              <Link to="/verify-email">
                <button className="w-full text-xs font-semibold bg-red-100 hover:bg-red-200 text-red-800 rounded-lg px-3 py-2 transition-colors mt-1">
                  Vai a verifica email (prova reinvio) →
                </button>
              </Link>
            </div>
          )}

          {/* Already registered (unconfirmed account) */}
          {apiError === '__already_registered__' && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-blue-800">Email già registrata</p>
                  <p className="text-xs text-blue-700 mt-0.5">
                    Questa email è già in uso. Se non hai mai verificato l'account, inserisci il codice che hai ricevuto.
                    Se ricordi la password, prova ad accedere direttamente.
                  </p>
                </div>
              </div>
              <div className="flex gap-2 mt-1">
                <Link to="/verify-email" className="flex-1">
                  <button className="w-full text-xs font-semibold bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg px-3 py-2 transition-colors">
                    Verifica account →
                  </button>
                </Link>
                <Link to="/login" className="flex-1">
                  <button className="w-full text-xs font-semibold bg-white hover:bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-2 transition-colors">
                    Accedi →
                  </button>
                </Link>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Username */}
            <div className="space-y-1.5">
              <Label htmlFor="username">Username</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="username"
                  placeholder="eco_user_42"
                  value={form.username}
                  onChange={update('username')}
                  className="pl-10"
                  aria-describedby={errors.username ? 'err-username' : undefined}
                />
              </div>
              {errors.username && <p id="err-username" className="text-xs text-red-600">{errors.username}</p>}
            </div>

            {/* Full name */}
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Nome completo</Label>
              <div className="relative">
                <UserCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="fullName"
                  placeholder="Mario Rossi"
                  value={form.fullName}
                  onChange={update('fullName')}
                  className="pl-10"
                  aria-describedby={errors.fullName ? 'err-fullName' : undefined}
                />
              </div>
              {errors.fullName && <p id="err-fullName" className="text-xs text-red-600">{errors.fullName}</p>}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="mario@esempio.it"
                  value={form.email}
                  onChange={update('email')}
                  className="pl-10"
                  aria-describedby={errors.email ? 'err-email' : undefined}
                />
              </div>
              {errors.email && <p id="err-email" className="text-xs text-red-600">{errors.email}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="password"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Minimo 8 caratteri"
                  value={form.password}
                  onChange={update('password')}
                  className="pl-10 pr-10"
                  aria-describedby={errors.password ? 'err-password' : undefined}
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
              {errors.password && <p id="err-password" className="text-xs text-red-600">{errors.password}</p>}
            </div>

            {/* Confirm password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Conferma password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  id="confirmPassword"
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Ripeti la password"
                  value={form.confirmPassword}
                  onChange={update('confirmPassword')}
                  className="pl-10"
                  aria-describedby={errors.confirmPassword ? 'err-confirm' : undefined}
                />
              </div>
              {errors.confirmPassword && <p id="err-confirm" className="text-xs text-red-600">{errors.confirmPassword}</p>}
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Registrazione...
                </span>
              ) : (
                'Crea account'
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-6">
            Hai già un account?{' '}
            <Link to="/login" className="text-eco-green font-semibold hover:underline">
              Accedi
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
