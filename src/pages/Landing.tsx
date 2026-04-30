import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Leaf, ArrowRight, Wind, BarChart3, Trophy, Bot, MapPin, Zap, Shield, Globe, Footprints, Bike, Bus, Car, Heart } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

function useCountUp(target: number, duration = 2000, start = false) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!start) return
    const steps = 60
    const increment = target / steps
    let current = 0
    const timer = setInterval(() => {
      current += increment
      if (current >= target) {
        setValue(target)
        clearInterval(timer)
      } else {
        setValue(Math.floor(current))
      }
    }, duration / steps)
    return () => clearInterval(timer)
  }, [target, duration, start])
  return value
}

const FEATURES = [
  {
    icon: MapPin,
    title: 'Traccia ogni viaggio',
    desc: 'Registra i tuoi spostamenti sostenibili con mappe interattive e calcolo automatico del risparmio CO₂.',
    color: 'bg-emerald-50 text-emerald-600',
  },
  {
    icon: BarChart3,
    title: 'Statistiche avanzate',
    desc: 'Analizza le tue performance settimanali e mensili con grafici dettagliati del tuo impatto ambientale.',
    color: 'bg-blue-50 text-blue-600',
  },
  {
    icon: Trophy,
    title: 'Compete e vinci',
    desc: 'Scala la classifica globale, sblocca badge esclusivi e sfida la community per il titolo di eco-campione.',
    color: 'bg-amber-50 text-amber-600',
  },
  {
    icon: Bot,
    title: 'AI Coach personale',
    desc: 'EcoCoach, il tuo assistente basato su Claude AI, ti guida con consigli personalizzati per migliorare ogni settimana.',
    color: 'bg-violet-50 text-violet-600',
  },
  {
    icon: Zap,
    title: 'Punti in tempo reale',
    desc: 'Ogni viaggio sostenibile ti porta punti istantaneamente. Più ti muovi verde, più guadagni.',
    color: 'bg-yellow-50 text-yellow-600',
  },
  {
    icon: Shield,
    title: 'Privacy garantita',
    desc: 'I tuoi dati sono protetti da Supabase con Row Level Security. Solo tu vedi i tuoi viaggi.',
    color: 'bg-rose-50 text-rose-600',
  },
]

const TRANSPORT_MODES: { icon: LucideIcon; color: string; label: string; co2: string }[] = [
  { icon: Footprints, color: 'text-emerald-500', label: 'A piedi',    co2: '0 g CO₂/km'  },
  { icon: Bike,       color: 'text-blue-500',    label: 'Bici',       co2: '0 g CO₂/km'  },
  { icon: Bus,        color: 'text-indigo-500',  label: 'Bus',        co2: '21 g CO₂/km' },
  { icon: Zap,        color: 'text-yellow-500',  label: 'Elettrico',  co2: '53 g CO₂/km' },
  { icon: Car,        color: 'text-orange-500',  label: 'Carpooling', co2: '43 g CO₂/km' },
]

export default function Landing() {
  const statsRef = useRef<HTMLDivElement>(null)
  const [statsVisible, setStatsVisible] = useState(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStatsVisible(true) },
      { threshold: 0.3 }
    )
    if (statsRef.current) observer.observe(statsRef.current)
    return () => observer.disconnect()
  }, [])

  const co2Value = useCountUp(48750, 2000, statsVisible)
  const kmValue = useCountUp(312400, 2000, statsVisible)
  const usersValue = useCountUp(8420, 2000, statsVisible)

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-eco-green rounded-lg flex items-center justify-center">
              <Leaf className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-xl text-gray-900">EcoTrack</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Accedi</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">Registrati</Link>
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-eco-green-light via-white to-emerald-50 pt-20 pb-28">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-96 h-96 bg-eco-green/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-emerald-300/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-eco-green-light border border-eco-green/20 rounded-full px-4 py-1.5 text-sm font-medium text-eco-teal mb-8 animate-fade-in">
            <Globe className="w-4 h-4" />
            Unisciti a 8.400+ utenti che stanno salvando il pianeta
          </div>
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold text-gray-900 leading-tight mb-6 animate-fade-in">
            Muoviti verde.{' '}
            <span className="text-eco-green">Guadagna punti.</span>
            <br />
            Salva il pianeta.
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10 animate-fade-in">
            EcoTrack trasforma ogni tuo spostamento sostenibile in punti, badge e classifiche.
            Tieni traccia della CO₂ che risparmi ogni giorno e dimostra il tuo impatto reale.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in">
            <Button size="xl" asChild className="shadow-lg shadow-eco-green/25">
              <Link to="/signup">
                Registrati
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
            <Button size="xl" variant="outline" asChild>
              <Link to="/login">Ho già un account</Link>
            </Button>
          </div>

          {/* Transport modes pills */}
          <div className="flex flex-wrap gap-3 justify-center mt-14">
            {TRANSPORT_MODES.map((m) => (
              <div
                key={m.label}
                className="flex items-center gap-2 bg-white border border-gray-100 rounded-full px-4 py-2 shadow-sm hover:shadow-md transition-shadow"
              >
                <m.icon className={`w-5 h-5 ${m.color}`} />
                <div className="text-left">
                  <p className="text-xs font-semibold text-gray-800">{m.label}</p>
                  <p className="text-xs text-gray-400">{m.co2}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Stats section */}
      <section ref={statsRef} className="py-16 bg-eco-green">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center text-white">
            <div>
              <p className="text-5xl font-extrabold">{co2Value.toLocaleString('it-IT')}</p>
              <p className="text-eco-green-light mt-2 font-medium">kg CO₂ risparmiati</p>
            </div>
            <div>
              <p className="text-5xl font-extrabold">{kmValue.toLocaleString('it-IT')}</p>
              <p className="text-eco-green-light mt-2 font-medium">km percorsi in verde</p>
            </div>
            <div>
              <p className="text-5xl font-extrabold">{usersValue.toLocaleString('it-IT')}</p>
              <p className="text-eco-green-light mt-2 font-medium">utenti attivi</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Tutto ciò che ti serve per muoverti verde</h2>
            <p className="text-xl text-gray-500 max-w-2xl mx-auto">
              Una piattaforma completa per tracciare, analizzare e migliorare la tua mobilità sostenibile.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc, color }) => (
              <div
                key={title}
                className="group p-6 rounded-2xl border border-gray-100 bg-white hover:shadow-lg hover:scale-[1.02] transition-all duration-200 cursor-default"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Come funziona</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Registrati gratis', desc: 'Crea il tuo account in 30 secondi con verifica email sicura.' },
              { step: '02', title: 'Registra i viaggi', desc: 'Inserisci ogni spostamento sostenibile: a piedi, in bici, sui mezzi pubblici o in auto condivisa.' },
              { step: '03', title: 'Scala la classifica', desc: 'Guadagna punti, sblocca badge e sfida la community per diventare l\'eco-campione della tua città.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="w-14 h-14 bg-eco-green rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-eco-green/25">
                  <span className="text-white font-bold text-lg">{step}</span>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA finale */}
      <section className="py-24 bg-gradient-to-r from-eco-green-dark to-eco-teal text-white text-center">
        <div className="max-w-3xl mx-auto px-4">
          <Wind className="w-16 h-16 mx-auto mb-6 opacity-80" />
          <h2 className="text-4xl font-bold mb-4">Inizia oggi a fare la differenza</h2>
          <p className="text-xl opacity-80 mb-8">Ogni chilometro sostenibile conta. Unisciti a chi già sta cambiando il mondo.</p>
          <Button size="xl" variant="outline" className="border-white text-white hover:bg-white hover:text-eco-green-dark" asChild>
            <Link to="/signup">Registrati <ArrowRight className="w-5 h-5" /></Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-8 text-center text-sm">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Leaf className="w-4 h-4 text-eco-green" />
          <span className="font-semibold text-white">EcoTrack</span>
        </div>
        <p className="flex items-center justify-center gap-1.5">© {new Date().getFullYear()} EcoTrack. Costruito con <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" /> per il pianeta.</p>
      </footer>
    </div>
  )
}
