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
import { validateSafeUrlWithDns } from './url-safety.js';

/*
 * Forma mínima de `TextDecoder` que necesita este fichero: sólo `decode`, y
 * sólo con entrada no nula, que es como se llama siempre aquí.
 *
 * Se declara a propósito en vez de anotar con el `TextDecoder` real de algún
 * sitio, porque los dos candidatos disponibles no son intercambiables: los
 * tipos de `@cloudflare/workers-types` y los de `@types/node` (`node:util`)
 * declaran `decode()` con firmas distintas (Node acepta `null` en la entrada,
 * Workers no), así que anotar con uno y dejar que el otro construya el valor
 * en tiempo de ejecución falla con "Type 'TextDecoder' is not assignable to
 * type 'TextDecoder'" en cuanto ambos conviven en la misma compilación — que
 * es exactamente lo que pasa en el tsconfig de la raíz, donde este paquete
 * convive con `worker.ts` y sus tipos de Workers.
 *
 * Con una interfaz estructural propia, cualquiera de los dos `TextDecoder`
 * reales encaja sin conflicto, y el tsconfig aislado del paquete publicable
 * —que no incluye `@cloudflare/workers-types` a propósito, porque `worker.ts`
 * queda fuera del artefacto de npm— tampoco necesita ya ningún import externo
 * para tener un *tipo*, y no sólo un valor, al que anotar.
 *
 * El parámetro de `decode` es `any` a propósito: `ArrayBuffer`/`ArrayBufferView`
 * tienen formas ligeramente distintas entre las declaraciones de Node y de
 * Workers (una acepta `null`, la otra parametriza `ArrayBufferView` de forma
 * genérica), y a esta función no le importa precisar eso — sólo que exista un
 * `decode` que reciba lo que ya se le pasa (`ArrayBuffer` o `Uint8Array`) y
 * devuelva una cadena.
 */
interface MinimalTextDecoder {
  decode(input: any): string;
}

/** Tamaño máximo de la respuesta que aceptamos descargar (5 MB). */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * Redirecciones que seguimos como máximo.
 *
 * Las seguimos a mano, saltando de una en una, en lugar de delegar en
 * `redirect: 'follow'`: sólo así se puede comprobar cada destino intermedio.
 * Con seguimiento automático, una URL pública que responda `302` hacia
 * `http://169.254.169.254/` se saltaría entera la defensa contra SSRF, porque
 * el runtime haría esa segunda petición sin pasar por nuestro filtro.
 */
export const MAX_REDIRECTS = 5;

/** Timeout de descarga por defecto (5 s). */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** User-Agent por defecto: identificable y con URL de contacto. */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; web-to-markdown/0.1; +https://github.com/carlosfuentesdev/web-to-markdown)';

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

  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  let finalUrl: string;
  try {
    // El timeout cubre toda la cadena de redirecciones, no cada salto: quien
    // llama pidió un límite total de espera, no uno por petición.
    ({ response, finalUrl } = await fetchFollowingSafeRedirects(target, fetchImpl, {
      signal: controller.signal,
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    }));
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

  const contentType = response.headers.get('content-type');
  assertHtmlContentType(contentType);
  assertDeclaredSize(response.headers.get('content-length'), maxBytes);

  const html = await readCappedText(response, maxBytes, contentType);
  if (html.trim().length === 0) {
    throw new ConvertError('empty_content', 'La página no devolvió contenido.');
  }

  return { html, url: finalUrl };
}

/** Códigos de estado que representan una redirección con destino en `Location`. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Descarga siguiendo las redirecciones a mano, validando cada destino.
 *
 * Cada salto pasa por {@link validateSafeUrlWithDns} antes de pedirse, de modo
 * que ni la URL original ni ninguna de las intermedias puedan apuntar a la red
 * interna. Devuelve la última respuesta y la URL que la produjo.
 */
async function fetchFollowingSafeRedirects(
  target: string,
  fetchImpl: FetchLike,
  options: { readonly signal: AbortSignal; readonly userAgent: string },
): Promise<{ response: Response; finalUrl: string }> {
  let current = target;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    // Lanza `blocked_host` si el destino apunta a la red interna. Va dentro del
    // bucle a propósito: comprobar sólo la primera URL no serviría de nada.
    await validateSafeUrlWithDns(current);

    // Ya validada, se normaliza: la URL canónica es la que se devuelve como
    // base para resolver los enlaces relativos del documento.
    current = new URL(current).toString();

    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: 'manual',
        signal: options.signal,
        headers: {
          'User-Agent': options.userAgent,
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
    }

    const location = response.headers.get('location');
    if (!REDIRECT_STATUSES.has(response.status) || location === null) {
      // No es una redirección utilizable: es la respuesta final, sea 200 o no.
      return { response, finalUrl: current };
    }

    // El cuerpo de una redirección no interesa, pero hay que cerrarlo para no
    // dejar la conexión abierta mientras seguimos con el salto siguiente.
    await response.body?.cancel().catch(() => undefined);

    try {
      // `Location` puede ser relativa; se resuelve contra la URL actual.
      current = new URL(location, current).toString();
    } catch {
      throw new ConvertError(
        'invalid_url',
        `La redirección apunta a una URL que no es válida: "${location}".`,
      );
    }
  }

  throw new ConvertError(
    'fetch_failed',
    `La página encadena más de ${MAX_REDIRECTS} redirecciones.`,
  );
}

/** Rechaza contenidos que claramente no son HTML (imágenes, PDF, JSON...). */
function assertHtmlContentType(contentType: string | null): void {
  // Sin cabecera Content-Type no hay nada que comprobar: lo intentamos. Es
  // una decisión deliberada, no un descuido — servidores mal configurados
  // que omiten esta cabecera son comunes, y rechazar de más perdería
  // páginas legítimas. El riesgo que esto podría abrir (un contenido no-HTML
  // grande y patológico colándose hasta el analizador) ya está cubierto de
  // forma independiente por `MAX_PARSE_BYTES` en `convert.ts`, que no
  // depende del Content-Type para nada.
  if (contentType === null || contentType.trim().length === 0) return;
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
async function readCappedText(
  response: Response,
  maxBytes: number,
  contentType: string | null,
): Promise<string> {
  const decoder = resolveTextDecoder(contentType);
  const body = response.body;
  if (body === null) return decoder.decode(await response.arrayBuffer());

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
  return decoder.decode(merged);
}

/** Extrae el `charset` de una cabecera Content-Type (p. ej. "text/html; charset=koi8-r"). */
function extractCharset(contentType: string | null): string | null {
  if (contentType === null) return null;
  const match = /charset\s*=\s*"?([^;"\s]+)"?/i.exec(contentType);
  return match?.[1]?.trim() ?? null;
}

/**
 * Resuelve el decodificador de texto a partir del `charset` declarado por el
 * servidor en `Content-Type`.
 *
 * No hacemos detección heurística (tipo chardet): sólo confiamos en lo que el
 * propio servidor declaró explícitamente. Si no declara nada, o declara un
 * encoding que el runtime no reconoce, caemos a UTF-8 (el comportamiento de
 * siempre) — nunca lo empeoramos, sólo lo mejoramos cuando hay información
 * fiable. `TextDecoder` en Cloudflare Workers implementa el estándar WHATWG
 * Encoding completo (a diferencia de `TextEncoder`, que sólo codifica a
 * UTF-8), así que basta con intentar construirlo: si la etiqueta no se
 * reconoce, lanza `RangeError` y lo capturamos aquí.
 */
function resolveTextDecoder(contentType: string | null): MinimalTextDecoder {
  const charset = extractCharset(contentType);
  if (charset === null) return new TextDecoder('utf-8');
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder('utf-8');
  }
}
