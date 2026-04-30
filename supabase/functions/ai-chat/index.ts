const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages } = await req.json()
    const hfToken = Deno.env.get('HF_TOKEN')

    if (!hfToken) {
      return new Response(JSON.stringify({ reply: '⚠️ HF_TOKEN non configurato.' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Costruisce prompt testuale
    const systemMsg = messages.find((m: {role:string}) => m.role === 'system')?.content ?? ''
    const history = messages.filter((m: {role:string}) => m.role !== 'system')
    let prompt = systemMsg + '\n\n'
    for (const m of history) {
      if (m.role === 'user') prompt += `Utente: ${m.content}\n`
      else prompt += `EcoCoach: ${m.content}\n`
    }
    prompt += 'EcoCoach:'

    // Endpoint per-model con chat completions (gratuito, serverless HF)
    const hfRes = await fetch(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3/v1/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hfToken}` },
        body: JSON.stringify({
          model: 'mistralai/Mistral-7B-Instruct-v0.3',
          messages: messages,
          max_tokens: 600,
          temperature: 0.7,
        }),
      }
    )

    const rawText = await hfRes.text()
    console.log('HF', hfRes.status, rawText.slice(0, 400))

    let reply = ''
    try {
      const json = JSON.parse(rawText)
      if (json?.choices?.[0]?.message?.content) {
        reply = json.choices[0].message.content
      } else if (json?.error) {
        reply = `⚠️ ${typeof json.error === 'string' ? json.error : JSON.stringify(json.error)}`
      } else {
        reply = `⚠️ Risposta inattesa: ${rawText.slice(0, 200)}`
      }
    } catch {
      reply = `⚠️ HF status ${hfRes.status} — ${rawText.slice(0, 200)}`
    }

    return new Response(JSON.stringify({ reply: reply.trim() || '(vuoto)' }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error(err)
    return new Response(JSON.stringify({ reply: `⚠️ Errore: ${String(err)}` }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
