const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders } });
}

// Simple rate limiter backed by KV. Keys are stored with an expiration TTL equal
// to the configured window. This is intentionally simple and works well for
// burst protection and inexpensive quotas. For production workloads consider
// Durable Objects for atomic counters.
async function incrKV(env, key, windowSeconds) {
  if (!env.RATE_KV) return 1; // KV not configured: no-op and allow
  try {
    const cur = await env.RATE_KV.get(key);
    if (cur === null) {
      await env.RATE_KV.put(key, '1', { expirationTtl: windowSeconds });
      return 1;
    }
    const n = (parseInt(cur, 10) || 0) + 1;
    await env.RATE_KV.put(key, String(n), { expirationTtl: windowSeconds });
    return n;
  } catch (e) {
    // On KV errors, fail open (do not block traffic). Log via console.
    console.warn('RATE_KV error', e);
    return 1;
  }
}

function getIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
}

// Very small IP sanity check to avoid accepting arbitrary strings.
function looksLikeIp(s) {
  if (!s || typeof s !== 'string') return false;
  // IPv6 contains ':'; accept as-is for basic validity
  if (s.indexOf(':') !== -1) return true;
  const parts = s.split('.')
  if (parts.length !== 4) return false;
  for (const p of parts) {
    if (!/^[0-9]+$/.test(p)) return false;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Healthcheck
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true });
    }

    const realIp = getIp(request);
    
      // Worker behavior toggles
      const ENFORCE = (() => {
        const v = env.WORKER_ENFORCE;
        if (v === undefined || v === null) return true;
        const s = String(v).toLowerCase();
        return !(s === '0' || s === 'false' || s === 'no');
      })();
      const FETCH_TIMEOUT_MS = Number(env.WORKER_FETCH_TIMEOUT_MS) || 3000;

      // Defaults and limits (configurable via environment variables)
      const DEFAULT_WINDOW = Number(env.RATE_LIMIT_WINDOW) || 900;
      const DEFAULT_LIMIT = Number(env.RATE_LIMIT_PER_IP) || 300;
      const AUTH_WINDOW = Number(env.AUTH_WINDOW) || 900;
      const MAX_BODY_BYTES = Number(env.MAX_BODY_BYTES) || (16 * 1024); // 16KB default
      const DEFAULT_IDENTIFIER_MAX = Number(env.MAX_IDENTIFIER_LENGTH) || 256;

      // Safely read and parse JSON while enforcing a maximum body size. If the
      // `Content-Length` header is present and exceeds the limit we fail fast.
      async function parseJsonWithLimit(req, maxBytes) {
        const lenHeader = req.headers.get('content-length');
        if (lenHeader && Number(lenHeader) > maxBytes) {
          const err = new Error('payload_too_large'); err.type = 'payload_too_large'; throw err;
        }
        const text = await req.text();
        if (text.length > maxBytes) { const err = new Error('payload_too_large'); err.type = 'payload_too_large'; throw err }
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch (e) {
          const err = new Error('invalid_json'); err.type = 'invalid_json'; throw err;
        }
      }

    // Configurable limits via environment variables; sensible defaults used
    const AUTH_MAX = Number(env.AUTH_RATE_LIMIT) || 5;
    if (ENFORCE) {
      const g = await incrKV(env, `rl:global:${realIp}`, DEFAULT_WINDOW);
      if (g > DEFAULT_LIMIT) {
        return jsonResponse({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': String(DEFAULT_WINDOW), 'X-Worker-Mode': 'enforced' });
      }
    }
    // Global per-IP counter (all endpoints)
    try {
      const g = await incrKV(env, `rl:global:${realIp}`, DEFAULT_WINDOW);
      if (g > DEFAULT_LIMIT) {
        return jsonResponse({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': String(DEFAULT_WINDOW) });
      }
    } catch (e) { console.warn('global rate check failed', e); }

    // Authentication attempt endpoint: POST /auth/attempt
        // If enforcement is disabled, return allowed quickly (kill-switch)
    if (!ENFORCE) {
      return jsonResponse({ success: true, allowed: true, remaining: Infinity, window: AUTH_WINDOW, disabled: true }, 200, { 'X-Worker-Mode': 'disabled' });
    }

    if (url.pathname === '/auth/attempt' && request.method === 'POST') {
      let body;
      try { body = await parseJsonWithLimit(request, MAX_BODY_BYTES); } catch (e) {
        if (e && e.type === 'payload_too_large') return jsonResponse({ success: false, error: 'payload_too_large' }, 413);
        return jsonResponse({ success: false, error: 'invalid-json' }, 400);
      }

      const identifierRaw = (body && (body.identifier || body.email || body.username)) || realIp;
      if (identifierRaw && typeof identifierRaw !== 'string') return jsonResponse({ success: false, error: 'invalid-identifier' }, 400);
      const identifier = identifierRaw ? identifierRaw.trim() : String(realIp);
      if (identifier.length > DEFAULT_IDENTIFIER_MAX) return jsonResponse({ success: false, error: 'identifier_too_long' }, 413);
      // Allow a trusted upstream (e.g., your Firebase blocking function) to provide
      // the originating client IP via `clientIp` in the JSON body. This override is
      // only accepted when the caller presents a matching secret token in either
      // `x-worker-secret` header or `Authorization: Bearer <token>`. Set the token
      // in the worker environment as `WORKER_TRUSTED_TOKEN`.
      let ipForAuth = realIp;
      const clientIpCandidate = body && body.clientIp;
      if (clientIpCandidate && env.WORKER_TRUSTED_TOKEN) {
        const rawHeader = request.headers.get('x-worker-secret') || request.headers.get('authorization') || '';
        const presented = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7) : rawHeader;
        if (presented && presented === env.WORKER_TRUSTED_TOKEN && looksLikeIp(clientIpCandidate)) {
          ipForAuth = clientIpCandidate;
        }
      }

      // Track both by IP and by identifier (email) to limit both vectors
      const byIp = await incrKV(env, `rl:auth:ip:${ipForAuth}`, AUTH_WINDOW);
      const byId = await incrKV(env, `rl:auth:id:${encodeURIComponent(identifier)}`, AUTH_WINDOW);

      const blocked = (byIp > AUTH_MAX) || (byId > AUTH_MAX);
      const remaining = Math.max(0, AUTH_MAX - Math.max(byIp, byId));

      if (blocked) {
        return jsonResponse({ success: false, allowed: false, remaining: 0, error: 'too_many_attempts' }, 429, { 'Retry-After': String(AUTH_WINDOW) });
      }

      return jsonResponse({ success: true, allowed: true, remaining, window: AUTH_WINDOW });
    }

    // Anything else: treat as Turnstile verify (legacy behavior)
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    let body;
    try { body = await parseJsonWithLimit(request, MAX_BODY_BYTES); } catch (e) {
      if (e && e.type === 'payload_too_large') return jsonResponse({ success: false, error: 'payload_too_large' }, 413);
      return jsonResponse({ success: false, error: 'invalid-json' }, 400);
    }

    // Accept either `token` or `response` fields (common names for Turnstile payloads)
    const token = (body && (body.token || body.response || body['cf-turnstile-response'])) || null;
    if (!token) {
      return jsonResponse({ success: false, error: 'missing-token' }, 400);
    }

    const secret = env.TURNSTILE_SECRET;
    if (!secret) {
      return jsonResponse({ success: false, error: 'missing-secret' }, 500);
    }

    const payload = `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`;

    let resp;
    try {
      resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: payload,
      });
    } catch (e) {
      return jsonResponse({ success: false, error: 'verify-request-failed', details: String(e) }, 502);
    }

    let json;
    try { json = await resp.json(); } catch (e) { return jsonResponse({ success: false, error: 'invalid-verify-response' }, 502); }

    const result = {
      success: !!json.success,
      challenge_ts: json.challenge_ts || null,
      hostname: json.hostname || null,
      action: json.action || null,
      raw: json,
    };

    return jsonResponse(result, 200);
  }
};
