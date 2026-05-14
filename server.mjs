import { createServer } from 'http'
import { readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const DIST = join(__dirname, 'dist')
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

const index = join(DIST, 'index.html')

createServer((req, res) => {
  // Strip query string
  const url = req.url.split('?')[0]
  const filePath = join(DIST, url)

  // Security: prevent path traversal
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403); res.end(); return
  }

  const ext = extname(filePath).toLowerCase()

  // Serve static asset if it exists as a file
  if (ext && existsSync(filePath) && statSync(filePath).isFile()) {
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
    // Cache immutable assets (hashed filenames)
    if (url.startsWith('/assets/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
    res.end(readFileSync(filePath))
    return
  }

  // SPA fallback → always serve index.html
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.end(readFileSync(index))
}).listen(PORT, () => {
  console.log(`EcoTrack server running on port ${PORT}`)
})
