<div align="center">

# 📄 web-to-markdown

**Turn any web page or raw HTML into clean, dense, LLM-ready Markdown.**
Strips the navigation, cookie banners, ads and footers; keeps the headings,
lists, code blocks, links and tables. Runs on Cloudflare Workers, Node, Deno and
Bun — and in your terminal.

[![npm](https://img.shields.io/npm/v/@karlangas12/web-to-markdown?color=cb3837&logo=npm)](https://www.npmjs.com/package/@karlangas12/web-to-markdown)
[![tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)](#testing)
[![latency](https://img.shields.io/badge/html%E2%86%92md-~3ms-blue)](#performance)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)
[![zero telemetry](https://img.shields.io/badge/telemetry-none-success)](#privacy)

[Quick start](#quick-start) · [CLI](#cli) · [SDK](#sdk) · [Edge](#run-it-on-the-edge) · [Limitations](#honest-limitations) · [Español](README.es.md)

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
in **single-digit milliseconds** and, because it uses only web-standard APIs,
runs anywhere: the edge, a serverless function, or a script.

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

## SDK

Everything the CLI uses is exported and dependency-light (one HTML parser, one
validator). It's synchronous for HTML, async only when it has to fetch.

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

### Metadata

With `extractMetadata: true` you also get:

```json
{
  "title": "Article title",
  "description": "A short summary.",
  "canonicalUrl": "https://example.com/article",
  "publishedAt": "2026-07-01T10:00:00.000Z",
  "wordCount": 1240,
  "estimatedTokens": 1660,
  "readingTimeMinutes": 6
}
```

Title falls back Open Graph → `<title>` → first `<h1>`; the publish date is
normalized to ISO 8601; the token count is a fast estimate (see the limitations).

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

## Run it on the edge

The conversion core uses only web-standard APIs (`fetch`, `URL`, `TextDecoder`,
`AbortController`), so it runs on Cloudflare Workers, Deno and Bun with no shim.
A minimal, deployable Worker built on the SDK lives in
[`examples/cloudflare-worker`](examples/cloudflare-worker):

```ts
import { convertUrl } from '@karlangas12/web-to-markdown';

export default {
  async fetch(request: Request): Promise<Response> {
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('Missing ?url=', { status: 400 });
    const { markdown } = await convertUrl(target);
    return new Response(markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
  },
};
```

That example is unauthenticated on purpose — it's a demo. For a real service, add
an API key, a per-plan rate limit, and (because it fetches arbitrary URLs) an
SSRF allow-list in front of the fetch. See [SECURITY.md](.github/SECURITY.md).

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
no analytics, nothing phones home.

## Part of a combo

`web-to-markdown` is one of a small toolkit for people wiring up AI agents. They
compose:

- **[openapi-to-mcp](https://www.npmjs.com/package/@karlangas12/openapi-to-mcp)** — turn any OpenAPI spec into a live MCP server (gives the agent **tools**).
- **[mcp-shield-proxy](https://github.com/Karlangas12/mcp-shield-proxy)** — a local firewall that inspects what your MCP tools do (gives it **safety**).
- **web-to-markdown** — feed those tools clean, dense context from the web (gives it **context**).

## Honest limitations

Worth reading before you rely on this.

- **It's a heuristic extractor, not a renderer.** It reads the HTML you give it;
  it does not execute JavaScript. A page that ships an empty `<div id="root">`
  and paints everything client-side has nothing to extract — you'd need a
  headless browser upstream, which this deliberately isn't.
- **Content selection is rules-based.** Whole-token class/id matching plus a
  `<main>`/`<article>` density pick handles the common cases well; an unusual
  layout can still leak a stray sidebar or clip a section. It's not a trained
  readability model.
- **The token count is an estimate.** A ~4-chars-per-token heuristic, close
  enough to size a context window — not a real BPE tokenizer, so don't bill on
  it.
- **Fetching arbitrary URLs is an SSRF surface.** Fine for a CLI on your machine;
  if you expose `convertUrl` as a public endpoint, filter the destination. See
  [SECURITY.md](.github/SECURITY.md).
- **Tables and code assume valid HTML.** Deeply malformed markup, or `<`
  characters left unescaped inside `<pre>`, can still confuse any HTML parser.

## Testing

```bash
npm test          # 38 tests: cleaning, markdown, metadata, fetch, tokens
npm run typecheck # strict TypeScript, no emit
npm run build     # compile the publishable SDK + CLI to dist/
```

## License

MIT — see [LICENSE](LICENSE).
