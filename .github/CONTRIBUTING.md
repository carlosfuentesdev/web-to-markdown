# Contributing to web-to-markdown

Thanks for considering a contribution. The most valuable ones are usually small:
a real web page that converts badly — a stray sidebar that leaks, a section that
gets clipped, a code block that loses its language — with a test that reproduces
it. Extraction edge cases are where this tool lives or dies.

## Requirements

- **Node.js ≥ 20** (the CI matrix runs 20 and 22).
- npm (the repo uses `package-lock.json`; use `npm ci` for reproducible installs).

## Getting started

```bash
git clone https://github.com/carlosfuentesdev/web-to-markdown.git
cd web-to-markdown
npm ci
npm test
```

## Before you open a pull request

Run the full quality gate locally — the same one CI runs:

```bash
npm run typecheck   # strict TypeScript, no errors allowed
npm test            # the whole suite must stay green
npm run build       # must compile cleanly
```

## Ground rules

- **Strict TypeScript, no exceptions.** `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `noUnusedLocals` are on. An array index is
  `T | undefined`; handle it.
- **Every new feature or bug fix ships with tests.** A change to cleaning or the
  DOM→Markdown conversion must come with a test case — ideally a **real** HTML
  fragment that reproduces the problem, not a synthetic one.
- **Keep dependencies light.** The runtime has exactly two (`node-html-parser`,
  `zod`). Adding a third needs a strong justification in the PR description — a
  headless browser or a heavyweight readability engine is exactly what this
  project avoids on purpose.
- **Stay edge-compatible.** The core uses only web-standard APIs (`fetch`, `URL`,
  `TextDecoder`, `AbortController`) so it runs on Cloudflare Workers, Deno and
  Bun as well as Node. Don't reach for a Node-only API in the conversion core.
- **Inject side effects.** The network goes through an injectable `fetch`; do the
  same for anything that touches the clock or the filesystem, so it stays
  testable.

## Commit style

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new conversion capability, output option, or CLI flag
- `fix:` a bug fix or an extraction/conversion correction
- `perf:` a performance improvement
- `docs:` documentation only
- `test:` tests only
- `chore:` tooling, CI, dependencies

Example: `feat(markdown): support definition lists (dl/dt/dd)`

## Reporting security vulnerabilities

**Do not open a public issue for a vulnerability.** See
[SECURITY.md](SECURITY.md) for private disclosure.
