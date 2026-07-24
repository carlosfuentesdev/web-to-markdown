# Cloudflare Worker example

A minimal edge API built on the `@karlangas12/web-to-markdown` SDK. It proves the
converter runs at the edge — the core uses only web-standard APIs, so no shim or
polyfill is needed.

This example is **deliberately unauthenticated**: it's a demo, not a service. For
anything public, add an API key, a per-plan rate limit, and — because it fetches
arbitrary URLs — an SSRF allow-list in front of the fetch (see
[SECURITY.md](../../.github/SECURITY.md)).

## Run it

```bash
# from this folder
npm install @karlangas12/web-to-markdown
npm install -D wrangler

npx wrangler dev      # http://localhost:8787
```

## Use it

```bash
# GET, raw Markdown
curl "http://localhost:8787/convert?url=https://example.com" -H "Accept: text/markdown"

# GET, JSON with metadata
curl "http://localhost:8787/convert?url=https://example.com&metadata=true"

# POST raw HTML
curl -X POST http://localhost:8787/convert \
  -H "Content-Type: application/json" \
  -d '{ "html": "<article><h1>Hi</h1><p>Body</p></article>", "options": { "extract_metadata": true } }'
```

## Deploy

```bash
npx wrangler deploy
```
