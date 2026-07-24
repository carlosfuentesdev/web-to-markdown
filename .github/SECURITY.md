# Security Policy

## Supported versions

`web-to-markdown` is pre-1.0. Security fixes are applied to the latest published
release. Pin a version if you need stability, and watch releases for advisories.

| Version | Supported |
| --- | --- |
| Latest `0.x` | ✅ |
| Older `0.x` | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.** Public
disclosure before a fix puts every user at risk.

Report privately through **GitHub's private vulnerability reporting**:

1. Go to the [**Security** tab](https://github.com/Karlangas12/web-to-markdown/security)
   of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue, the affected version, and a reproduction if you have one.

## What to expect

- **Acknowledgement within 48 hours.**
- An initial assessment and a proposed timeline shortly after.
- Credit in the release notes when the fix is published, unless you prefer to
  remain anonymous.

## Scope

The `convertUrl` / `GET ?url=` path fetches a URL **you (or your caller) supply**.
If you expose this as a public service, that fetch is the sharp edge:

- **Server-Side Request Forgery (SSRF).** A caller can ask the service to fetch
  internal addresses — `localhost`, private ranges, cloud metadata endpoints
  (`169.254.169.254`). If you deploy the converter as an open endpoint, put an
  allow/deny list or an egress proxy in front of the fetch. The library follows
  redirects, so validate the **final** destination, not just the input.
- **Resource exhaustion.** Downloads are bounded by a hard timeout (5 s) and a
  size cap (5 MB, checked by header *and* while streaming). If you raise those,
  you own the DoS surface you create.

Genuinely in scope for a report: a way to make `fetchHtml` exceed its size cap,
follow a redirect past an intended host filter, hang past its timeout, or a
crafted HTML input that makes the parser/converter blow up memory or CPU
(super-linear pathological input).

Out of scope: the fact that a page you point it at can contain anything — the
tool converts content, it does not vouch for it. Treat converted Markdown from an
untrusted page as untrusted data (that is exactly what
[mcp-shield-proxy](https://github.com/Karlangas12/mcp-shield-proxy) is for on the
agent side).
