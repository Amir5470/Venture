const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ ok: true });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
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
    try {
      json = await resp.json();
    } catch (e) {
      return jsonResponse({ success: false, error: 'invalid-verify-response' }, 502);
    }

    // Return a minimal, predictable shape while preserving raw response
    const result = {
      success: !!json.success,
      challenge_ts: json.challenge_ts || null,
      hostname: json.hostname || null,
      action: json.action || null,
      // Keep compatibility with Turnstile's shape
      raw: json,
    };

    return jsonResponse(result, 200);
  }
};
