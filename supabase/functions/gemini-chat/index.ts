// ═══════════════════════════════════════════════════════════════════════════
// Supabase Edge Function — proxy sicuro per Gemini
//
// La API key vive SOLO qui, come secret del server:
//   supabase secrets set GEMINI_API_KEY=...
//   supabase functions deploy gemini-chat
//
// Il browser non riceve mai la key: chiama questa funzione con la sessione
// Supabase dell'utente (JWT verificato) e riceve solo il testo della risposta.
// ═══════════════════════════════════════════════════════════════════════════

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type GeminiPart = { text: string }
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

type GeminiResponse = {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  error?: { message?: string; code?: number; status?: string }
}

// Modelli in ordine di priorità: se il primo è sovraccarico si usa il secondo
const MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash']
const MAX_MESSAGES = 40
const MAX_TOTAL_CHARS = 12_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function isValidContents(value: unknown): value is GeminiContent[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return false
  let total = 0
  for (const item of value) {
    if (!item || typeof item !== 'object') return false
    const c = item as GeminiContent
    if (c.role !== 'user' && c.role !== 'model') return false
    if (!Array.isArray(c.parts) || c.parts.length === 0) return false
    for (const part of c.parts) {
      if (!part || typeof part.text !== 'string') return false
      total += part.text.length
    }
  }
  return total <= MAX_TOTAL_CHARS
}

async function callGemini(apiKey: string, system: string, contents: GeminiContent[]) {
  let lastError = 'Errore sconosciuto'

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise(resolve => setTimeout(resolve, attempt * 700))
      }

      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
              contents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
            }),
          },
        )

        let data: GeminiResponse | null = null
        try {
          data = await res.json() as GeminiResponse
        } catch {
          lastError = `HTTP ${res.status}`
          continue
        }

        if (data.error) {
          lastError = data.error.message ?? `HTTP ${res.status}`
          const code = data.error.code ?? res.status
          // Sovraccarico / rate limit → ritenta (prima stesso modello, poi fallback)
          if (code === 503 || code === 429 || data.error.status === 'UNAVAILABLE') continue
          return { error: lastError }
        }

        const candidate = data.candidates?.[0]
        const text = candidate?.content?.parts?.map(part => part.text ?? '').join('') ?? ''
        if (!text.trim()) {
          lastError = 'Risposta vuota da Gemini'
          continue
        }

        return {
          text: text.trim(),
          truncated: candidate?.finishReason === 'MAX_TOKENS',
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }
  }

  return { error: lastError }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Metodo non consentito' }, 405)
  }

  // ── 1. Solo utenti autenticati (evita abusi sulla quota AI) ────────────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const authHeader = req.headers.get('Authorization')

  if (!supabaseUrl || !anonKey || !authHeader) {
    return json({ error: 'Non autenticato' }, 401)
  }

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return json({ error: 'Non autenticato' }, 401)
  }

  // ── 2. Secret lato server (mai nel bundle del browser) ─────────────────────
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY non configurata sul server' }, 503)
  }

  // ── 3. Validazione input ───────────────────────────────────────────────────
  let body: { system?: unknown; contents?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'JSON non valido' }, 400)
  }

  const system = typeof body.system === 'string' ? body.system.slice(0, 20_000) : ''
  if (!isValidContents(body.contents)) {
    return json({ error: 'Richiesta non valida' }, 400)
  }

  // ── 4. Chiamata a Gemini e risposta ────────────────────────────────────────
  const result = await callGemini(apiKey, system, body.contents)
  if ('error' in result) {
    return json(result, 502)
  }
  return json(result)
})
