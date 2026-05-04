#!/usr/bin/env node
// tools/test-auth-attempt.js
// Simple Node.js script to test the /auth/attempt endpoint.
// Usage examples:
//  node tools/test-auth-attempt.js --mock --count 6 --interval 200 --mock-limit 5
//  node tools/test-auth-attempt.js --url https://<worker>.workers.dev --count 6 --identifier test@example.com

const http = require('http')
const https = require('https')
const { URL } = require('url')

function parseArgs() {
  const argv = process.argv.slice(2)
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mock') { out.mock = true; continue }
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const val = argv[++i]
    out[key] = val
  }
  return out
}

function startMockServer(port, limit, windowSeconds) {
  const MAX_BODY_BYTES = 16 * 1024
  const counts = {}
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/auth/attempt') {
      res.statusCode = 404; res.end('Not found'); return
    }
    const lenHeader = Number(req.headers['content-length'] || 0)
    if (lenHeader > MAX_BODY_BYTES) { res.statusCode = 413; res.end('payload too large'); return }
    let body = ''
    req.on('data', c => body += c)
    req.on('end', () => {
      try {
        if (body.length > MAX_BODY_BYTES) { res.statusCode = 413; res.end('payload too large'); return }
        const j = body ? JSON.parse(body) : {}
        const id = j.identifier || 'anon'
        counts[id] = counts[id] || { n: 0, ts: Date.now() }
        counts[id].n++
        const n = counts[id].n
        if (n > limit) {
          res.statusCode = 429
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Retry-After', String(windowSeconds))
          res.end(JSON.stringify({ allowed: false, remaining: 0 }))
          return
        }
        const remaining = Math.max(0, limit - n)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ allowed: true, remaining }))
      } catch (err) {
        res.statusCode = 400; res.end('invalid json')
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve({ server, url: `http://127.0.0.1:${port}` }))
    server.on('error', reject)
  })
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const lib = u.protocol === 'https:' ? https : http
    const data = JSON.stringify(payload)
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }
    const req = lib.request(opts, (res) => {
      let buf = ''
      res.setEncoding('utf8')
      res.on('data', c => buf += c)
      res.on('end', () => {
        try {
          const parsed = buf ? JSON.parse(buf) : null
          resolve({ status: res.statusCode, headers: res.headers, body: parsed })
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body: buf })
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

(async () => {
  const args = parseArgs()
  const action = args.action || 'login'
  const identifier = args.identifier || 'test@example.com'
  const count = parseInt(args.count || '6', 10)
  const interval = parseInt(args.interval || '200', 10)
  const mock = !!args.mock
  const mockLimit = parseInt(args['mock-limit'] || args['mockLimit'] || '5', 10)
  const mockWindow = parseInt(args['mock-window'] || args['mockWindow'] || '900', 10)
  const url = args.url || (mock ? 'http://127.0.0.1:12345' : null)
  if (!url) { console.error('Missing --url or use --mock'); process.exit(1) }

  let mockServer
  if (mock) {
    const { server, url: base } = await startMockServer(12345, mockLimit, mockWindow)
    mockServer = server
    console.log(`Started mock server at ${base} (limit=${mockLimit}, window=${mockWindow}s)`)
  }

  for (let i = 1; i <= count; i++) {
    try {
      const res = await postJson(`${url.replace(/\/$/, '')}/auth/attempt`, { action, identifier })
      const ra = res.headers && (res.headers['retry-after'] || res.headers['Retry-After'])
      console.log(`[${i}] ${res.status} ${JSON.stringify(res.body)}${ra ? ' (Retry-After: ' + ra + ')' : ''}`)
    } catch (err) {
      console.error(`[${i}] request error`, err && err.message ? err.message : err)
    }
    if (i < count) await sleep(interval)
  }

  if (mockServer) {
    mockServer.close()
    console.log('Mock server stopped.')
  }
})().catch(err => { console.error('Fatal:', err); process.exit(1) })
