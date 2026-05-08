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

// -------------------- GitHub & Firebase helpers --------------------
async function verifyGithubSignature(request, secret) {
  if (!secret) return false;
  const sigHeader = request.headers.get('x-hub-signature-256') || '';
  if (!sigHeader) return false;
  const payload = await request.clone().arrayBuffer();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, payload);
  const hex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  const computed = 'sha256=' + hex;
  return timingSafeEqual(computed, sigHeader);
}

function timingSafeEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function writeToFirebase(env, path, obj) {
  if (!env.FIREBASE_DATABASE_URL) throw new Error('missing FIREBASE_DATABASE_URL');
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  let url = `${base}${path}.json`;
  const headers = { 'Content-Type': 'application/json' };
  if (env.FIREBASE_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${env.FIREBASE_ACCESS_TOKEN}`;
  } else if (env.FIREBASE_DATABASE_SECRET) {
    url += `?auth=${encodeURIComponent(env.FIREBASE_DATABASE_SECRET)}`;
  } else {
    throw new Error('no firebase credentials configured (FIREBASE_ACCESS_TOKEN or FIREBASE_DATABASE_SECRET)');
  }
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(obj) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`firebase write failed ${res.status} ${text}`);
  }
  return res;
}

async function readFromFirebase(env, path) {
  if (!env.FIREBASE_DATABASE_URL) throw new Error('missing FIREBASE_DATABASE_URL');
  const base = env.FIREBASE_DATABASE_URL.replace(/\/$/, '');
  let url = `${base}${path}.json`;
  const headers = {};
  if (env.FIREBASE_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${env.FIREBASE_ACCESS_TOKEN}`;
  } else if (env.FIREBASE_DATABASE_SECRET) {
    url += `?auth=${encodeURIComponent(env.FIREBASE_DATABASE_SECRET)}`;
  } else {
    throw new Error('no firebase credentials configured (FIREBASE_ACCESS_TOKEN or FIREBASE_DATABASE_SECRET)');
  }
  const res = await fetch(url, { method: 'GET', headers });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`firebase read failed ${res.status} ${text}`);
  }
  return await res.json();
}

async function fetchGitHubGraphQL(owner, name, token) {
  if (!token) throw new Error('missing github token for graphQL');
  const query = `\n    query ($owner: String!, $name: String!) {\n      repository(owner: $owner, name: $name) {\n        name\n        url\n        stargazerCount\n        pushedAt\n        primaryLanguage { name }\n      }\n    }\n  `;
  const resp = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `bearer ${token}` },
    body: JSON.stringify({ query, variables: { owner, name } })
  });
  if (!resp.ok) throw new Error('GitHub GraphQL fetch failed: ' + resp.status);
  const json = await resp.json();
  return json.data;
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

    // --- GitHub OAuth + Webhook endpoints ---------------------------------
    // OAuth start: redirect user to GitHub authorization URL
    if (url.pathname === '/github/oauth/start' && request.method === 'GET') {
      const clientId = env.GITHUB_CLIENT_ID;
      if (!clientId) return jsonResponse({ success: false, error: 'missing_github_client_id' }, 500);
      const state = url.searchParams.get('state') || Math.random().toString(36).slice(2);
      const redirectUri = (env.WORKER_BASE_URL ? env.WORKER_BASE_URL.replace(/\/$/, '') : url.origin) + '/github/oauth/callback';
      const scopes = env.GITHUB_OAUTH_SCOPES || 'repo';
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;
      return Response.redirect(authUrl, 302);
    }

    // OAuth callback: exchange code for access token and postMessage to opener
    if (url.pathname === '/github/oauth/callback' && request.method === 'GET') {
      const code = url.searchParams.get('code');
      if (!code) return new Response('Missing code', { status: 400, headers: CORS_HEADERS });
      const redirectUri = (env.WORKER_BASE_URL ? env.WORKER_BASE_URL.replace(/\/$/, '') : url.origin) + '/github/oauth/callback';
      try {
        const tokRes = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri })
        });
        const tokJson = await tokRes.json();
        if (!tokJson.access_token) return new Response(JSON.stringify(tokJson), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }});
        const safeData = JSON.stringify({ type: 'github_oauth_token', token: tokJson.access_token });
        const html = `<!doctype html><html><body><script>try{window.opener.postMessage(${safeData}, '*')}catch(e){}try{window.close()}catch(e){}</script><p>Token received — you can close this window.</p></body></html>`;
        return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html', ...CORS_HEADERS }});
      } catch (e) {
        return jsonResponse({ success: false, error: 'oauth_exchange_failed', details: String(e) }, 502);
      }
    }

    // GitHub webhook receiver: verify signature, enrich via GraphQL, update Firebase
    if (url.pathname === '/github/webhook' && request.method === 'POST') {
      try {
        const ok = await verifyGithubSignature(request, env.GITHUB_WEBHOOK_SECRET);
        if (!ok) return new Response('invalid signature', { status: 401, headers: CORS_HEADERS });
      } catch (e) {
        return jsonResponse({ success: false, error: 'signature_error', details: String(e) }, 400);
      }
      let payload;
      try { payload = await request.clone().json(); } catch (e) { return jsonResponse({ success:false, error:'invalid_json' }, 400); }
      const repository = payload.repository || {};
      const owner = repository.owner?.login || (repository.owner && repository.owner.name) || null;
      const name = repository.name || repository.full_name || null;
      const pushedAt = payload.head_commit?.timestamp || repository.pushed_at || new Date().toISOString();
      let repoStats = { owner, name, last_updated: pushedAt };
      if (env.GITHUB_GRAPHQL_TOKEN && owner && name) {
        try {
          const data = await fetchGitHubGraphQL(owner, name, env.GITHUB_GRAPHQL_TOKEN);
          if (data && data.repository) {
            repoStats = {
              ...repoStats,
              stargazerCount: data.repository.stargazerCount || 0,
              primaryLanguage: data.repository.primaryLanguage ? { name: data.repository.primaryLanguage.name } : null,
              url: data.repository.url || `https://github.com/${owner}/${name}`,
              pushedAt: data.repository.pushedAt || pushedAt
            };
          }
        } catch (e) { console.warn('graphQL fetch failed', e); }
      }
      try {
        if (owner && name) await writeToFirebase(env, `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, repoStats);
      } catch (e) { console.warn('firebase write failed', e); }
      return new Response('ok', { status: 200, headers: CORS_HEADERS });
    }

    // Trigger backend fetch for a user's repos using their stored token in RTDB
    if (url.pathname === '/github/fetch' && request.method === 'GET') {
      const owner = url.searchParams.get('owner');
      const uid = url.searchParams.get('uid');
      if (!owner) return jsonResponse({ success: false, error: 'missing_owner' }, 400);
      try {
        let token = null;
        if (uid) {
          // Read token metadata from RTDB: /github/tokens/{uid}
          const tokenData = await readFromFirebase(env, `/github/tokens/${encodeURIComponent(uid)}`);
          if (!tokenData || !tokenData.token) return jsonResponse({ success: false, error: 'no_token_for_user' }, 404);
          // Only proceed if owner matches or the user enabled public fetch
          const publicFetch = !!tokenData.publicFetch;
          if (String(tokenData.owner || '').toLowerCase() !== String(owner).toLowerCase() && !publicFetch) {
            return jsonResponse({ success: false, error: 'fetch_not_allowed' }, 403);
          }
          token = tokenData.token;
        } else {
          // No uid provided: fall back to worker-level GitHub token (must be configured)
          token = env.GITHUB_GRAPHQL_TOKEN || env.GITHUB_CLIENT_SECRET || null;
          if (!token) return jsonResponse({ success: false, error: 'no_server_token' }, 403);
        }

        // Use REST list to get repositories for the owner (covers public repos)
        const listUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100`;
        const listResp = await fetch(listUrl, { headers: { Authorization: token ? `token ${token}` : undefined, Accept: 'application/vnd.github.v3+json' } });
        if (!listResp.ok) {
          const text = await listResp.text().catch(()=>'');
          return jsonResponse({ success: false, error: 'github_list_failed', status: listResp.status, body: text }, 502);
        }
        const repos = await listResp.json();
        // Persist each repo to RTDB under /github/repos/{owner}/{name}
        for (const item of repos) {
          const name = item.name;
          const stat = {
            owner,
            name,
            url: item.html_url,
            stargazerCount: item.stargazers_count || 0,
            watchersCount: item.watchers_count || 0,
            commits: null,
            pushedAt: item.pushed_at || null,
            primaryLanguage: item.language ? { name: item.language } : null,
          };
          try {
            await writeToFirebase(env, `/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, stat);
          } catch (e) {
            console.warn('firebase write failed for', owner, name, e);
          }
        }
        return jsonResponse({ success: true, written: repos.length });
      } catch (e) {
        console.warn('backend fetch failed', e);
        return jsonResponse({ success: false, error: 'backend_fetch_error', details: String(e) }, 500);
      }
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
