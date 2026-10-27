import { createServer } from 'http'
import { readFileSync, statSync } from 'fs'
import { join, extname, sep } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(__dirname, 'dist')
const INDEX = join(DIST, 'index.html')
const PORT = process.env.PORT || 3000

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'application/javascript',
  '.mjs':   'application/javascript',
  '.css':   'text/css',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.webp':  'image/webp',
  '.ico':   'image/x-icon',
  '.json':  'application/json',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':   'font/ttf',
  '.map':   'application/json',
}

// True only for files strictly inside DIST. A plain startsWith() would also
// match sibling directories like `dist-evil` or `dist_backup`.
function isInsideDist(filePath) {
  return filePath === DIST || filePath.startsWith(DIST + sep)
}

function isFile(filePath) {
  try {
    return statSync(filePath).isFile()
  } catch {
    return false
  }
}

function sendSpAFallback(req, res) {
  try {
    const html = readFileSync(INDEX)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.end(req.method === 'HEAD' ? undefined : html)
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Build non trovata: esegui "npm run build" prima di avviare il server.')
  }
}

createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' })
    res.end()
    return
  }

  let pathname = '/'
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0])
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  const filePath = join(DIST, pathname)

  // Security: prevent path traversal (and prefix bypasses)
  if (!isInsideDist(filePath)) {
    res.writeHead(403)
    res.end()
    return
  }

  if (isFile(filePath)) {
    try {
      const body = readFileSync(filePath)
      res.setHeader('Content-Type', MIME[extname(filePath).toLowerCase()] || 'application/octet-stream')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      // Cache immutable hashed assets
      if (pathname.startsWith('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
      res.end(req.method === 'HEAD' ? undefined : body)
    } catch {
      res.writeHead(500)
      res.end()
    }
    return
  }

  // SPA fallback → always serve index.html
  sendSpAFallback(req, res)
}).listen(PORT, () => {
  console.log(`EcoTrack server running on port ${PORT}`)
})
