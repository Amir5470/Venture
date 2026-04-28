# Turnstile verify Cloudflare Worker

1) Install Wrangler (if not already):

```bash
npm install -g wrangler
```

2) Create the secret in your Cloudflare account (locally):

```bash
wrangler secret put TURNSTILE_SECRET
```

3) Publish the worker:

```bash
wrangler publish
```

4) Update the client code to point `TURNSTILE_VERIFY_URL` to your worker URL.
