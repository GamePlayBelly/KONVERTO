import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Bot, User, Sparkles, Leaf, RotateCcw, Target, Bike, Globe, Trophy, Bus, AlertTriangle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getTrips } from '@/lib/supabase'
import { TRANSPORT_META, formatCO2 } from '@/lib/utils'
import type { ChatMessage, Trip } from '@/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string
// Modelli in ordine di priorità: se il primo è sovraccarico, si tenta il secondo
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash']
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

interface GeminiPart { text: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }
interface GeminiResponse {
  candidates?: { content: { parts: GeminiPart[]; role: string }; finishReason?: string }[]
  error?: { message: string; code?: number; status?: string }
}

function geminiUrl(model: string) {
  return `${GEMINI_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`
}

function friendlyError(raw: string): string {
  const l = raw.toLowerCase()
  if (l.includes('high demand') || l.includes('overloaded') || l.includes('503') || l.includes('unavailable'))
    return 'Il servizio AI è temporaneamente sovraccarico. Riprova tra qualche secondo ⏳'
  if (l.includes('quota') || l.includes('429') || l.includes('rate limit'))
    return 'Limite di richieste raggiunto. Aspetta un momento e riprova 🔄'
  if (l.includes('api key') || l.includes('invalid') || l.includes('401') || l.includes('403'))
    return 'Chiave API non valida. Controlla le impostazioni. 🔑'
  if (l.includes('network') || l.includes('failed to fetch'))
    return 'Errore di connessione. Controlla la tua rete e riprova 🌐'
  return 'Errore temporaneo con il servizio AI. Riprova tra poco 🔄'
}

async function callGemini(systemPrompt: string, history: ChatMessage[], userText: string): Promise<string> {
  const contents: GeminiContent[] = [
    ...history.map(m => ({
      role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: userText }] },
  ]
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  })

  let lastError = 'Errore sconosciuto'

  for (const model of GEMINI_MODELS) {
    // Fino a 3 tentativi per ogni modello
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        // Backoff: 1s, 2s
        await new Promise(r => setTimeout(r, attempt * 1000))
      }
      try {
        const res = await fetch(geminiUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })

        let data: GeminiResponse
        try {
          data = await res.json() as GeminiResponse
        } catch {
          // Risposta non-JSON (raro)
          if (res.status === 503 || res.status === 429) {
            lastError = `HTTP ${res.status}`
            continue // ritenta
          }
          throw new Error(`HTTP ${res.status}`)
        }

        if (data.error) {
          const code = data.error.code ?? res.status
          lastError = data.error.message
          // 503 / 429 / UNAVAILABLE → ritenta
          if (code === 503 || code === 429 || data.error.status === 'UNAVAILABLE') continue
          // Qualsiasi altro errore → esci subito con messaggio friendly
          throw new Error(friendlyError(data.error.message))
        }

        const candidate = data.candidates?.[0]
        const text = candidate?.content?.parts?.[0]?.text
        if (!text) throw new Error('Risposta vuota da Gemini')
        // Se troncata per token, aggiungi marker speciale
        if (candidate?.finishReason === 'MAX_TOKENS') {
          return text.trim() + '​__TRUNCATED__'
        }
        return text.trim()

      } catch (err: unknown) {
        // Se è già un errore friendly (lanciato da noi), rilancia
        if (err instanceof Error && !err.message.includes('HTTP')) throw err
        lastError = err instanceof Error ? err.message : String(err)
        // Errori di rete → ritenta
        continue
      }
    }
    // Tutti i tentativi per questo modello falliti → passa al modello di fallback
  }

  throw new Error(friendlyError(lastError))
}

const QUICK_PROMPTS: { icon: LucideIcon; color: string; text: string }[] = [
  { icon: Target,  color: 'text-eco-teal',   text: 'Suggeriscimi un obiettivo settimanale realistico' },
  { icon: Bike,    color: 'text-blue-500',   text: 'Come posso iniziare ad andare in bici al lavoro?' },
  { icon: Globe,   color: 'text-teal-500',   text: 'Qual è il mio impatto ambientale questa settimana?' },
  { icon: Trophy,  color: 'text-amber-500',  text: 'Come posso scalare la classifica più velocemente?' },
  { icon: Bus,     color: 'text-indigo-500', text: 'Alternative sostenibili per i miei tragitti abituali' },
]

const SYSTEM_PROMPT = `Sei EcoCoach, l'assistente AI di EcoTrack — la piattaforma italiana di mobilità sostenibile aziendale.
Il tuo ruolo: dare consigli personalizzati, motivare l'utente, spiegare come funziona l'app e aiutare a ridurre le emissioni CO₂.
Stile: professionale ma amichevole, concreto e sintetico. Usa emoji con moderazione. Rispondi SEMPRE in italiano.
Non inventare dati che non hai. Se l'utente ha dati, usali. Incoraggia sempre azioni positive.`

function buildContext(trips: Trip[], ecoScore: number, co2Total: number): string {
  if (trips.length === 0) return `[Utente: eco_score=${ecoScore} pts, nessun viaggio ancora registrato]`
  const modeCounts: Record<string, number> = {}
  let totalKm = 0
  trips.slice(0, 30).forEach(t => {
    modeCounts[t.transport_mode] = (modeCounts[t.transport_mode] ?? 0) + 1
    totalKm += Number(t.distance_km)
  })
  const topMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'N/A'
  const label = TRANSPORT_META[topMode as keyof typeof TRANSPORT_META]?.label ?? topMode
  return `[Utente: eco_score=${ecoScore} pts, CO₂_totale=${co2Total.toFixed(1)}kg, viaggi=${trips.length}, km_totali=${totalKm.toFixed(0)}, mezzo_preferito=${label}]`
}

// ── Lightweight Markdown renderer ────────────────────────────────────────────
// Handles: **bold**, *italic*, `code`, # headings, - bullets, numbered lists, blank lines

function renderInline(text: string): React.ReactNode[] {
  // Split on **bold**, *italic*, `code` markers
  const parts: React.ReactNode[] = []
  const re = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2] !== undefined) parts.push(<strong key={key++}>{m[2]}</strong>)
    else if (m[3] !== undefined) parts.push(<em key={key++}>{m[3]}</em>)
    else if (m[4] !== undefined) parts.push(<code key={key++} className="bg-gray-100 text-eco-teal rounded px-1 py-0.5 text-[11px] font-mono">{m[4]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function MarkdownMessage({ content }: { content: string }): React.ReactElement {
  const lines = content.split('\n')
  const nodes: React.ReactNode[] = []
  let listBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let key = 0

  const flushList = () => {
    if (!listBuffer.length) return
    if (listType === 'ul') {
      nodes.push(
        <ul key={key++} className="list-disc pl-4 space-y-0.5 my-1">
          {listBuffer.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ul>
      )
    } else {
      nodes.push(
        <ol key={key++} className="list-decimal pl-4 space-y-0.5 my-1">
          {listBuffer.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </ol>
      )
    }
    listBuffer = []
    listType = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Heading # / ##
    if (/^###\s+/.test(line)) {
      flushList()
      nodes.push(<p key={key++} className="font-bold text-xs text-gray-500 uppercase tracking-wide mt-2 mb-0.5">{renderInline(line.replace(/^###\s+/, ''))}</p>)
      continue
    }
    if (/^##\s+/.test(line)) {
      flushList()
      nodes.push(<p key={key++} className="font-bold text-sm mt-2 mb-0.5">{renderInline(line.replace(/^##\s+/, ''))}</p>)
      continue
    }
    if (/^#\s+/.test(line)) {
      flushList()
      nodes.push(<p key={key++} className="font-bold text-base mt-2 mb-0.5">{renderInline(line.replace(/^#\s+/, ''))}</p>)
      continue
    }

    // Unordered list: - / * / •
    const ulMatch = line.match(/^[-*•]\s+(.*)/)
    if (ulMatch) {
      if (listType === 'ol') flushList()
      listType = 'ul'
      listBuffer.push(ulMatch[1])
      continue
    }

    // Ordered list: 1. 2. etc.
    const olMatch = line.match(/^\d+\.\s+(.*)/)
    if (olMatch) {
      if (listType === 'ul') flushList()
      listType = 'ol'
      listBuffer.push(olMatch[1])
      continue
    }

    flushList()

    // Blank line = paragraph break (small gap)
    if (line === '') {
      nodes.push(<div key={key++} className="h-1.5" />)
      continue
    }

    // Normal paragraph line
    nodes.push(<p key={key++} className="leading-snug">{renderInline(line)}</p>)
  }

  flushList()
  return <div className="space-y-0.5 text-sm">{nodes}</div>
}

export default function AIAssistant() {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [trips, setTrips] = useState<Trip[]>([])
  const [tripsLoaded, setTripsLoaded] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (user) getTrips(user.id, 30).then(t => { setTrips(t); setTripsLoaded(true) })
  }, [user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const context = buildContext(trips, profile?.eco_score ?? 0, Number(profile?.total_co2_saved ?? 0))
      const systemWithCtx = `${SYSTEM_PROMPT}\n\n${context}`

      const raw = await callGemini(systemWithCtx, messages, text.trim())
      const truncated = raw.endsWith('​__TRUNCATED__')
      const reply = truncated ? raw.slice(0, -'​__TRUNCATED__'.length) : raw
      setMessages(prev => [...prev, { role: 'assistant', content: reply, truncated }])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Errore di connessione con Gemini'
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: msg,
        isError: true,
        retryText: text.trim(),
      }])
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }, [loading, messages, trips, profile])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-8rem)] lg:h-[calc(100vh-4rem)] pb-4 lg:pb-0 space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-eco-green to-eco-teal rounded-xl flex items-center justify-center shadow-sm shadow-eco-green/30">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">EcoCoach AI</h1>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-eco-green" />
              Powered by Gemini 2.5 Flash · Consigli personalizzati
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
        )}
      </div>

      {/* Chat */}
      <Card className="flex-1 overflow-hidden flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-eco-green-light rounded-2xl flex items-center justify-center mx-auto">
                <Leaf className="w-8 h-8 text-eco-green" />
              </div>
              <div>
                <p className="text-gray-900 font-bold text-lg flex items-center justify-center gap-2">Ciao! Sono EcoCoach <Leaf className="w-5 h-5 text-eco-green" /></p>
                <p className="text-sm text-gray-500 max-w-xs mx-auto mt-1">
                  {tripsLoaded && trips.length > 0
                    ? `Ho analizzato i tuoi ${trips.length} viaggi. Chiedimi consigli personalizzati!`
                    : 'Il tuo coach per la mobilità sostenibile. Come posso aiutarti?'}
                </p>
              </div>
              {profile && (
                <div className="inline-flex items-center gap-2 bg-eco-green-light text-eco-teal rounded-full px-4 py-1.5 text-sm font-medium">
                  <Leaf className="w-4 h-4" />
                  {profile.eco_score} pts · {formatCO2(Number(profile.total_co2_saved))} CO₂ risparmiata
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2.5 animate-fade-in ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${msg.role === 'assistant' ? 'bg-eco-green' : 'bg-gray-200'}`}>
                {msg.role === 'assistant' ? <Bot className="w-4 h-4 text-white" /> : <User className="w-4 h-4 text-gray-600" />}
              </div>
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-eco-green text-white rounded-tr-sm text-sm'
                  : msg.isError
                    ? 'bg-red-50 text-red-700 rounded-tl-sm border border-red-100 text-sm'
                    : 'bg-gray-50 text-gray-800 rounded-tl-sm border border-gray-100'
              }`}>
                {msg.role === 'user' || msg.isError ? (
                  <>
                    {msg.isError && <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 text-red-500" />}
                    <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                    {msg.isError && msg.retryText && (
                      <button
                        onClick={() => {
                          setMessages(prev => prev.filter((_, idx) => idx !== i))
                          sendMessage(msg.retryText!)
                        }}
                        className="mt-2 flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-700 underline"
                      >
                        <RotateCcw className="w-3 h-3" /> Riprova
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <MarkdownMessage content={msg.content} />
                    {msg.truncated && (
                      <button
                        onClick={() => sendMessage('Continua da dove ti sei fermato')}
                        className="mt-2 flex items-center gap-1 text-xs font-semibold text-eco-green hover:text-eco-teal underline"
                      >
                        <RotateCcw className="w-3 h-3" /> Continua risposta…
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2.5">
              <div className="w-8 h-8 rounded-full bg-eco-green flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-gray-50 rounded-2xl rounded-tl-sm border border-gray-100 px-4 py-3 space-y-2 min-w-[160px]">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-56" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </CardContent>
      </Card>

      {/* Quick prompts */}
      {messages.length === 0 && (
        <div className="flex gap-2 flex-wrap flex-shrink-0">
          {QUICK_PROMPTS.map(p => (
            <button
              key={p.text}
              onClick={() => sendMessage(p.text)}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs bg-eco-green-light text-eco-teal rounded-full px-3 py-1.5 hover:bg-green-100 transition-colors font-medium border border-eco-green/10 disabled:opacity-50"
            >
              <p.icon className={`w-3.5 h-3.5 ${p.color} flex-shrink-0`} />
              <span className="hidden sm:inline">{p.text.length > 35 ? p.text.slice(0, 35) + '…' : p.text}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end flex-shrink-0">
        <Textarea
          ref={textareaRef}
          placeholder="Chiedimi consigli sulla mobilità sostenibile..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          className="flex-1 resize-none"
          disabled={loading}
        />
        <Button
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || loading}
          size="icon"
          className="h-12 w-12 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
