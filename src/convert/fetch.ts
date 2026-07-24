/**
 * Descarga eficiente del HTML de una página.
 *
 * Objetivos de robustez para un servicio en el edge:
 * - User-Agent limpio e identificable (evita bloqueos básicos y es honesto).
 * - Sigue redirecciones, con timeout duro (<5 s) para no colgar el aislado.
 * - Límite de tamaño (5 MB) comprobado por cabecera Y por streaming, para no
 *   cargar en memoria una respuesta gigante que reviente el Worker.
 * - Valida que el contenido sea HTML antes de gastar CPU parseándolo.
 */

import { ConvertError } from './errors.js';

/** Tamaño máximo de la respuesta que aceptamos descargar (5 MB). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Timeout de descarga por defecto (5 s). */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** User-Agent por defecto: identificable y con URL de contacto. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; web-to-markdown/0.1; +https://github.com/Karlangas12/web-to-markdown)';

/** Firma de `fetch`, para poder inyectar un doble en los tests. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface FetchHtmlOptions {
  /** User-Agent a enviar. Por defecto, {@link DEFAULT_USER_AGENT}. */
  readonly userAgent?: string;
  /** Timeout en milisegundos. Por defecto, {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Límite de bytes. Por defecto, {@link MAX_RESPONSE_BYTES}. */
  readonly maxBytes?: number;
  /** Implementación de `fetch` a usar. Por defecto, la global del runtime. */
  readonly fetchImpl?: FetchLike;
}

/** Página descargada: su HTML y la URL final tras las redirecciones. */
export interface FetchedPage {
  readonly html: string;
  readonly url: string;
}

/** Descarga y valida el HTML de una URL. Lanza `ConvertError` si algo falla. */
export async function fetchHtml(target: string, options: FetchHtmlOptions = {}): Promise<FetchedPage> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
  if (fetchImpl === undefined) {
    throw new ConvertError('fetch_failed', 'El runtime no dispone de fetch(). Actualiza a Node >= 20.');
  }

  const url = parseHttpUrl(target);
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en,es;q=0.8',
      },
    });
  } catch (cause) {
    throw new ConvertError(
      'fetch_failed',
      'No se pudo descargar la página (timeout, DNS o red). Comprueba la URL.',
      { cause },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ConvertError(
      'http_error',
      `La página respondió con el estado HTTP ${response.status}.`,
      { upstreamStatus: response.status },
    );
  }

  assertHtmlContentType(response.headers.get('content-type'));
  assertDeclaredSize(response.headers.get('content-length'), maxBytes);

  const html = await readCappedText(response, maxBytes);
  if (html.trim().length === 0) {
    throw new ConvertError('empty_content', 'La página no devolvió contenido.');
  }

  return { html, url: response.url.length > 0 ? response.url : url.toString() };
}

/** Valida y normaliza la URL; solo se admite http(s). */
function parseHttpUrl(target: string): URL {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new ConvertError('invalid_url', `La URL no es válida: "${target}".`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConvertError('unsupported_protocol', 'Solo se admiten URLs http:// y https://.');
  }
  return url;
}

/** Rechaza contenidos que claramente no son HTML (imágenes, PDF, JSON...). */
function assertHtmlContentType(contentType: string | null): void {
  if (contentType === null || contentType.trim().length === 0) return; // sin cabecera: lo intentamos
  const normalized = contentType.toLowerCase();
  const looksLikeHtml =
    normalized.includes('text/html') ||
    normalized.includes('application/xhtml') ||
    normalized.includes('text/plain');
  if (!looksLikeHtml) {
    throw new ConvertError('not_html', `El contenido no es HTML (content-type: ${contentType}).`);
  }
}

/** Rechaza por adelantado si la cabecera Content-Length ya supera el límite. */
function assertDeclaredSize(contentLength: string | null, maxBytes: number): void {
  if (contentLength === null) return;
  const declared = Number(contentLength);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ConvertError(
      'too_large',
      `La página supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    );
  }
}

/**
 * Lee el cuerpo como texto sin pasar del límite de bytes.
 *
 * Comprueba el tamaño mientras hace streaming, porque Content-Length puede
 * mentir (o no venir) y no queremos que una respuesta enorme reviente la memoria.
 */
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (body === null) return response.text();

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ConvertError(
        'too_large',
        `La página supera el límite de ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(merged);
}
