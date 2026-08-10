<div align="center">

# 📄 web-to-markdown

**Turn any web page or raw HTML into clean, dense, LLM-ready Markdown.**
Strips the navigation, cookie banners, ads and footers; keeps the headings,
lists, code blocks, links and tables. Runs at the edge (Cloudflare Workers) and
in your terminal.

[![CI](https://github.com/Karlangas12/web-to-markdown/actions/workflows/ci.yml/badge.svg)](https://github.com/Karlangas12/web-to-markdown/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@karlangas12/web-to-markdown?color=cb3837&logo=npm)](https://www.npmjs.com/package/@karlangas12/web-to-markdown)
[![tests](https://img.shields.io/badge/tests-43%20passing-brightgreen)](#testing)
[![latency](https://img.shields.io/badge/html%E2%86%92md-~3ms-blue)](#performance)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![zero telemetry](https://img.shields.io/badge/telemetry-none-success)](#privacy)

[Quick start](#quick-start) · [CLI](#cli) · [HTTP API](#http-api) · [SDK](#sdk) · [Deploy](#deploy-your-own-edge-api) · [Limitations](#honest-limitations) · [Español](README.es.md)

</div>

```
  https://a-page.com/article          # ...or a blob of raw HTML
            │
            ▼
   ┌───────────────────┐   strip nav / header / footer / aside / ads / cookies
   │  web-to-markdown  │   keep h1–h6, lists, code, links, tables (GFM)
   └───────────────────┘   collapse whitespace · estimate tokens
            │
            ▼
   # Clean Markdown, ready to paste into a context window
```

---

## Why

Feeding a raw web page to an LLM is expensive and lossy. A typical article page
is 90% chrome — menus, cookie notices, "related posts", tracking scripts — and
the HTML markup itself burns tokens that carry no meaning. You pay for all of it
and the model reads around it.

`web-to-markdown` does one thing: it extracts the actual content and emits the
densest faithful Markdown it can, so a context window holds more signal per
token. No headless browser, no heavyweight parser — a small AST pass that runs
in **single-digit milliseconds** and deploys to the edge at zero idle cost.

It's built for the places that consume context: Cursor, Claude Code, RAG
pipelines, and autonomous agents that need to read a page mid-task.

## Quick start

Convert a URL straight from your terminal — no install:

```bash
npx @karlangas12/web-to-markdown https://example.com/article
```

Or use it as a library:

```bash
npm install @karlangas12/web-to-markdown
```

```ts
import { convertUrl } from '@karlangas12/web-to-markdown';

const { markdown } = await convertUrl('https://example.com/article');
console.log(markdown);
```

## CLI

```bash
web-to-markdown <url>                 # download and convert a URL
web-to-markdown page.html             # convert a local HTML file
cat page.html | web-to-markdown -     # convert HTML from stdin
```

| Flag | Effect |
| --- | --- |
| `-o, --output <file>` | Write to a file instead of stdout |
| `--images` | Keep images as `![alt](src)` (dropped by default) |
| `--json` / `--metadata` | Emit `{ markdown, metadata }` JSON instead of raw Markdown |
| `--timeout <ms>` | Download timeout (default `5000`) |
| `--user-agent <ua>` | Override the User-Agent sent when fetching |
| `-h, --help` · `-v, --version` | Help / version |

```bash
# Save an article, images included, as a file
web-to-markdown https://example.com/post --images -o post.md

# Get metadata (title, description, canonical, published date, token estimate)
web-to-markdown https://example.com/post --json > post.json
```

Markdown goes to **stdout**; status lines go to **stderr** — so pipes stay clean.

## HTTP API

### Overview

**Web to Markdown API** turns any public URL (or a raw HTML blob) into clean,
LLM-ready Markdown over a simple authenticated HTTP endpoint. It runs on
Cloudflare Workers, so every request is served at the edge with no cold
infrastructure to manage.

**Base URL (production):**

```
https://web-to-markdown.karlangas12.workers.dev
```

### Authentication & quotas

Every request under `/v1/*` requires an API key, sent as:

```
x-api-key: your_api_key
```

(`Authorization: Bearer your_api_key` is also accepted, if that fits your
client better.) `GET /salud` is public and needs no key.

| Plan | Quota | Window |
| --- | --- | --- |
| Free | 500 conversions | per calendar month |
| Pro | 2,000 conversions | per calendar month |

Every authenticated response carries standard rate-limit headers:

| Header | Meaning |
| --- | --- |
| `RateLimit-Limit` | The quota for your plan, in this window |
| `RateLimit-Remaining` | Requests left before the window resets |
| `RateLimit-Reset` | Unix timestamp (seconds) when the window resets |

Once the quota is spent, the API responds `429 Too Many Requests` with a
`Retry-After` header (seconds until the next window).

### Endpoints

#### `GET /salud`

Public health check. No API key required.

```bash
curl https://web-to-markdown.karlangas12.workers.dev/salud
```

`200 OK`:

```json
{
  "ok": true,
  "data": { "estado": "ok", "entorno": "production" }
}
```

#### `POST /v1/convert`

Converts a page to Markdown. Body is JSON with exactly one of `url` or `html`:

```json
{ "url": "https://example.com" }
```

Optional `options`: `{ "include_images": false, "extract_metadata": true }`
(both default to `false`).

**`200 OK`** — conversion succeeded:

```json
{
  "ok": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is for use in documentation examples…",
    "metadata": null
  }
}
```

Set `Accept: text/markdown` (or `?format=markdown` on the `GET` variant below)
to get the raw Markdown body instead of the JSON envelope.

**`401 Unauthorized`** — the `x-api-key` header is missing or the key isn't
valid:

```json
{
  "ok": false,
  "error": { "code": "unauthorized", "message": "La API key no es válida." }
}
```

**`429 Too Many Requests`** — you've used up your plan's monthly quota:

```json
{
  "ok": false,
  "error": { "code": "rate_limited", "message": "Has superado el límite de 500 peticiones. Reintenta en 1234 s." }
}
```

There's also a one-shot `GET /v1/convert?url=` variant for agents and curl
one-liners; pass `?metadata=true` / `?images=true` to enable those options.

### Code examples

**cURL**

```bash
curl -X POST https://web-to-markdown.karlangas12.workers.dev/v1/convert \
  -H "x-api-key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com" }'
```

**JavaScript / TypeScript** (native `fetch` — Node.js 18+ or browser)

```ts
const response = await fetch('https://web-to-markdown.karlangas12.workers.dev/v1/convert', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.WEB_TO_MARKDOWN_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: 'https://example.com' }),
});

const { data } = await response.json();
console.log(data.markdown);
```

**Python** (`requests`)

```python
import os
import requests

response = requests.post(
    "https://web-to-markdown.karlangas12.workers.dev/v1/convert",
    headers={"x-api-key": os.environ["WEB_TO_MARKDOWN_API_KEY"]},
    json={"url": "https://example.com"},
)
response.raise_for_status()
print(response.json()["data"]["markdown"])
```

### Getting an API key

API keys are provisioned through [Polar.sh](https://polar.sh), the billing
provider behind the Free and Pro plans. Subscribe directly:

- [Subscribe to Free — 500 requests/month, €0](https://buy.polar.sh/polar_cl_cDg8li7Rt4bcDmx5DirqhiEFrgMozTKiTJ8b513oy4F)
- [Subscribe to Pro — 2,000 requests/month, €5/mo](https://buy.polar.sh/polar_cl_YF0y9Ej4ypE0afXDbAP1Dnx8HiNuafPHAsRNG4VQvAp)

Prefer to see pricing and product details first? [View the full product
page](https://thenapply.dev/web-to-markdown/).

1. Subscribe to the Free or Pro plan through the Polar checkout for this
   product.
2. Polar notifies us of your subscription; we issue your `x-api-key` and send
   it to the email address on your Polar account.
3. Upgrading or cancelling your Polar subscription automatically raises or
   lowers your existing key's quota — no need to request a new key.

> Key issuance today is a manual step on our side rather than instant
> self-service delivery — expect your key shortly after subscribing, not
> immediately in the checkout flow.

Auth, per-plan rate limiting and the billing webhook all come from the
factory core — see
[Deploy your own edge API](#deploy-your-own-edge-api) if you're running your
own instance instead of using the hosted one above.

## SDK

Everything the CLI and Worker use is exported and dependency-light (one HTML
parser, one validator). It's synchronous for HTML, async only when it has to
fetch.

```ts
import {
  convertHtml,      // (html, options?) => { markdown, metadata }
  convertUrl,       // (url, options?) => Promise<{ markdown, metadata }>
  fetchHtml,        // (url, options?) => Promise<{ html, url }>
  estimateTokens,   // rough token count for any string
  ConvertError,     // typed errors with a stable `code`
} from '@karlangas12/web-to-markdown';

// From raw HTML (no network) — great for scrapers you already run
const { markdown, metadata } = convertHtml(rawHtml, {
  includeImages: false,
  extractMetadata: true,
  baseUrl: 'https://example.com/article',   // resolves relative links
});

// From a URL, with an injectable fetch (handy in tests)
const page = await convertUrl('https://example.com', {
  timeoutMs: 4000,
  fetchImpl: myFetch,
});
```

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `includeImages` | `false` | Emit images as `![alt](src)` |
| `extractMetadata` | `false` | Compute the `metadata` object |
| `baseUrl` | — | Base for resolving relative links/images (auto-filled by `convertUrl`) |
| `timeoutMs` | `5000` | Fetch timeout (`convertUrl` / `fetchHtml`) |
| `maxBytes` | `5 MB` | Hard cap on the downloaded response |
| `userAgent` | identifiable UA | User-Agent header sent when fetching |

## What it does

**Removes the noise.** `script`, `style`, `iframe`, `svg`, `form` and friends
go first. Then `nav`, `aside`, page `header`/`footer`, and any container whose
`class`/`id`/`role` reads as chrome — `cookie-banner`, `ad-container`,
`newsletter`, `sidebar`, `related`, … — matched by whole token, so `gradient`
isn't mistaken for `ad` and an `entry-header` that carries the title survives.

**Keeps the meaning.** Headings map to `#`–`######`, ordered/unordered lists
nest with correct indentation, `<pre><code class="language-x">` becomes a fenced
block with its language, blockquotes get `>`, and tables become GitHub-flavored
Markdown with escaped pipes.

**Shrinks the tokens.** Redundant whitespace collapses, trailing spaces go, runs
of blank lines fold to a single paragraph break. The result is Markdown a model
reads cleanly with nothing spent on layout.

**Reads the metadata.** Optionally returns title (Open Graph → `<title>` →
first `<h1>`), description, canonical URL, detected publish date (normalized to
ISO 8601), word count, a fast token estimate and reading time.

### Framework-hydrated pages

**Recovers content a SPA left behind — without running any JavaScript.** When
the visible DOM comes back essentially empty (the classic
`<div id="root"></div>`), it looks for the data the framework already
serialized into the HTML for its own hydration, and reads that instead. Four
sources, tried in order of how much they can be trusted:

| Source | What it is |
| --- | --- |
| `application/ld+json` | schema.org JSON-LD. A real standard, explicitly labelled, framework-independent — by far the most reliable, so it wins when several are present. |
| `__NEXT_DATA__` | Next.js Pages Router. One well-formed JSON blob. |
| `self.__next_f.push(...)` | Next.js App Router (RSC). A chunked, escaped stream; prose is recovered from it best-effort, since the format is neither public nor stable. |
| `window.__NUXT__` | Nuxt, and only when that value happens to be JSON. Sometimes it's a self-invoking function instead, and then it's skipped rather than evaluated. |

Be clear about what this is and isn't. It is **parsing text that already
arrived in the response** — no JS engine, no browser, no evaluation of
anything. It is not rendering, and it is not a general answer to "handle
JavaScript sites". If a page fetches its content after load, or hides it behind
a framework this doesn't recognise, you get the same empty result as before.
The fallback only kicks in when the normal extraction yields under 200
characters, and only replaces it when it actually recovers more text — a short
but legitimate page is never traded for stray fragments of a JSON blob.

**Refuses to touch your internal network.** URLs pointing at loopback, private
or link-local addresses — `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, `169.254.0.0/16` (which includes the `169.254.169.254` cloud
metadata endpoint), `localhost`, `::1`, `fc00::/7`, `fe80::/10` — are rejected
before any request goes out. This is deliberate, not configurable: this library
is built to be handed URLs that came from your users, and without that filter it
would be an SSRF proxy into whatever network you run it on. Every redirect hop
is re-checked too, so a public URL can't bounce you somewhere private. On
Node.js the hostname is also resolved and each resulting IP is checked, which
catches public domains that quietly point at `127.0.0.1`; on Cloudflare Workers,
where no DNS resolver is exposed, only the literal check applies.

## Deploy your own edge API

The Worker is not published to npm — you deploy your own with
[Wrangler](https://developers.cloudflare.com/workers/). It ships with the full
monetizable circuit from the factory core: **validated config → structured
logging → API-key auth → per-plan rate limit → conversion**, plus a
Merchant-of-Record webhook endpoint for billing.

```bash
wrangler kv namespace create CLAVES        # API keys (hash → record)
wrangler kv namespace create CONTADORES    # rate-limit counters
wrangler kv namespace create EVENTOS       # webhook idempotency
# paste each returned id into wrangler.toml

wrangler secret put POLAR_WEBHOOK_SECRET   # billing webhook signing secret

wrangler dev        # http://localhost:8787
wrangler deploy
```

`GET /salud` is an unauthenticated health probe. `/v1/*` requires an API key
(`Authorization: Bearer …` or `X-API-Key`) and enforces the caller's plan quota,
returning `RateLimit-*` headers. `POST /webhooks/polar` receives Polar's
subscription events and activates or reverts the caller's plan accordingly.

## Performance

Conversion is pure CPU on the request path, so the budget is tight: the target
is **under 10 ms for a standard document**. Measured on Node 22 / Windows 11, a
14.5 KB article page (≈2 000 tokens of output), 2 000 iterations:

| | mean | p50 | p90 | **p99** |
| --- | --- | --- | --- | --- |
| HTML → Markdown (+ metadata) | 3.1 ms | 2.9 ms | 4.4 ms | **5.4 ms** |

Cost scales roughly with document size (~n·log n in practice); a very large
58 KB page runs ~19 ms. The `convertUrl` path adds the network fetch, bounded by
the 5 s timeout and the 5 MB size cap. No headless browser is ever launched.

## Privacy

The library and CLI make exactly one network call — the page you asked for —
and only in `convertUrl`. `convertHtml` touches no network at all. No telemetry,
no analytics, nothing phones home. What you deploy on your own Worker is yours.

## Part of a combo

`web-to-markdown` is the third asset of a small toolkit for people wiring up AI
agents. They compose:

- **[openapi-to-mcp](https://www.npmjs.com/package/@karlangas12/openapi-to-mcp)** — turn any OpenAPI spec into a live MCP server.
- **[mcp-shield-proxy](https://github.com/Karlangas12/mcp-shield-proxy)** — a local firewall that inspects what your MCP tools do.
- **web-to-markdown** — feed those tools clean, dense context from the web.

## Honest limitations

Worth reading before you rely on this.

- **It's a heuristic extractor, not a renderer.** It reads the HTML you give it
  and **never executes JavaScript** — there is no JS engine and no browser
  anywhere in this package. When a client-rendered page ships an empty
  `<div id="root">`, it falls back to reading the data the framework already
  serialized into the response (see [Framework-hydrated pages](#framework-hydrated-pages)),
  which covers a good share of Next.js and Nuxt sites but not all of them. A
  page whose content only exists after its own code runs — fetched on mount,
  say — still has nothing to extract, and no amount of parsing will change
  that. For those you need a headless browser upstream, which this
  deliberately isn't.
- **Content selection is rules-based.** Whole-token class/id matching plus a
  `<main>`/`<article>` density pick handles the common cases well; an unusual
  layout can still leak a stray sidebar or clip a section. It's not a trained
  readability model.
- **The token count is an estimate.** A ~4-chars-per-token heuristic, close
  enough to size a context window — not a real BPE tokenizer, so don't bill on
  it.
- **Key issuance is manual, not self-service.** Polar subscriptions upgrade or
  revert the plan of a key you already issued; a brand-new subscriber doesn't
  get a key automatically — see [Getting an API key](#getting-an-api-key).
- **Tables and code assume valid HTML.** Deeply malformed markup, or `<`
  characters left unescaped inside `<pre>`, can still confuse any HTML parser.

## Testing

```bash
npm test          # 43 tests: cleaning, markdown, metadata, fetch, worker
npm run typecheck # strict TypeScript, no emit
npm run build     # compile the publishable SDK + CLI to dist/
```

## License

MIT — see [LICENSE](LICENSE).
