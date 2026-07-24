/**
 * Ejemplo mínimo: web-to-markdown como API en Cloudflare Workers.
 *
 * Usa SOLO el SDK publicado (`@karlangas12/web-to-markdown`), sin dependencias
 * añadidas ni framework: el núcleo de conversión es autónomo y usa únicamente
 * APIs web estándar, así que corre tal cual en el runtime de Workers.
 *
 * A propósito NO trae autenticación, cuotas ni facturación: es la demostración
 * de "esto corre en el edge". Para un servicio de verdad, pon delante una API
 * key, un rate limit por plan y —si expones el fetch a URLs arbitrarias— una
 * lista de permitidos contra SSRF (ver ../../.github/SECURITY.md).
 *
 * Desplegar:  npm i -D wrangler && npx wrangler deploy
 * Probar:     npx wrangler dev   →  http://localhost:8787
 */

import { convertHtml, convertUrl, isConvertError } from '@karlangas12/web-to-markdown';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== '/convert') {
      return json({ error: 'Not found. Use POST or GET /convert.' }, 404);
    }

    try {
      // GET /convert?url=...&metadata=true&images=true
      if (request.method === 'GET') {
        const target = url.searchParams.get('url');
        if (target === null || target.length === 0) {
          return json({ error: 'Missing "url" query parameter.' }, 400);
        }
        const result = await convertUrl(target, {
          includeImages: truthy(url.searchParams.get('images')),
          extractMetadata: truthy(url.searchParams.get('metadata')),
        });
        return respond(request, result);
      }

      // POST /convert  { url | html, options?: { include_images, extract_metadata } }
      if (request.method === 'POST') {
        const body = (await request.json()) as {
          url?: string;
          html?: string;
          options?: { include_images?: boolean; extract_metadata?: boolean };
        };
        const opts = {
          includeImages: body.options?.include_images ?? false,
          extractMetadata: body.options?.extract_metadata ?? false,
        };
        const result =
          typeof body.url === 'string'
            ? await convertUrl(body.url, opts)
            : typeof body.html === 'string'
              ? convertHtml(body.html, opts)
              : null;
        if (result === null) {
          return json({ error: 'Send exactly one of "url" or "html".' }, 400);
        }
        return respond(request, result);
      }

      return json({ error: 'Method not allowed. Use GET or POST.' }, 405);
    } catch (error) {
      // Los errores de conversión llevan un mensaje legible; el resto, genérico.
      const message = isConvertError(error) ? error.message : 'Conversion failed.';
      const status = isConvertError(error) ? 400 : 500;
      return json({ error: message }, status);
    }
  },
};

/** Devuelve Markdown crudo si el Accept lo pide; si no, JSON con metadatos. */
function respond(
  request: Request,
  result: { markdown: string; metadata: unknown },
): Response {
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  if (accept.includes('text/markdown')) {
    return new Response(result.markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
  }
  return json(result, 200);
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function truthy(value: string | null): boolean {
  return value === 'true' || value === '1' || value === 'yes' || value === 'on';
}
