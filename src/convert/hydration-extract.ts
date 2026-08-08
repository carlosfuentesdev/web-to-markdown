/**
 * Rescate de contenido embebido en el HTML por los frameworks de SPA.
 *
 * El problema que resuelve: una página de Next.js o Nuxt renderizada en cliente
 * llega con el cuerpo vacío —`<div id="root"></div>`— y la extracción normal
 * del DOM devuelve nada. Pero el contenido suele venir igualmente en la
 * respuesta, serializado dentro de un `<script>` para que el framework
 * rehidrate la página en el navegador. Si está ahí, se puede leer.
 *
 * IMPORTANTE — esto NO ejecuta JavaScript. No hay motor de JS, ni navegador, ni
 * evaluación de nada: se parsea texto que ya venía en la descarga. Por eso sólo
 * funciona con los formatos concretos que sabemos leer, y no con una página que
 * de verdad necesite ejecutar código para producir su contenido (por ejemplo,
 * una que lo pida por `fetch` después de cargar). Para ese caso este paquete
 * sigue sin ser la herramienta adecuada, y conviene decirlo claro.
 *
 * Orden de preferencia:
 *   1. JSON-LD (`application/ld+json`) — es un estándar de schema.org, va
 *      etiquetado y suele traer el artículo ya limpio. El más fiable con
 *      diferencia, y además no depende de ningún framework.
 *   2. `__NEXT_DATA__` — Next.js con Pages Router: un único JSON bien formado.
 *   3. `self.__next_f.push(...)` — Next.js con App Router (RSC): un flujo
 *      troceado y escapado, del que se rescata el texto que se pueda.
 *   4. `window.__NUXT__` — Nuxt. A veces es JSON y a veces una expresión de
 *      JavaScript; sólo se aprovecha cuando resulta ser lo primero.
 *
 * Todo el módulo es defensivo: cualquier payload puede venir truncado, mal
 * formado o no ser lo que aparenta. Nada de aquí debe lanzar nunca — en el peor
 * caso se devuelve `null` y quien llama sigue con lo que ya tenía.
 */

import type { HTMLElement } from 'node-html-parser';

/** Fuentes de datos embebidos que sabemos leer. */
export type HydrationSource = 'json-ld' | 'next-data' | 'next-flight' | 'nuxt';

/** Contenido rescatado de los datos embebidos. */
export interface HydratedContent {
  /** De qué fuente salió, para poder distinguirlo en tests y depuración. */
  readonly source: HydrationSource;
  /** Markdown ya listo, con el mismo formato que produce el camino normal. */
  readonly markdown: string;
}

/**
 * Scripts recogidos del documento antes de podarlo.
 *
 * Se guardan como texto suelto y no como nodos porque `cleanDocument` elimina
 * los `<script>` del árbol: para cuando sabemos que hacen falta, ya no están.
 */
export interface HydrationScripts {
  readonly jsonLd: readonly string[];
  readonly nextData: readonly string[];
  readonly nextFlight: readonly string[];
  readonly nuxt: readonly string[];
}

/** Tamaño máximo de payload que aceptamos procesar (2 MB). */
const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024;

/** Profundidad máxima al recorrer el JSON, por si viene muy anidado. */
const MAX_DEPTH = 12;

/** Longitud mínima para que una cadena cuente como prosa y no como un id. */
const MIN_PROSE_CHARS = 40;

/** Tope de fragmentos que se concatenan, para no construir un texto enorme. */
const MAX_PROSE_BLOCKS = 200;

/** Claves cuyo valor se trata como título del documento. */
const TITLE_KEYS = new Set(['headline', 'title', 'name', 'heading', 'pagetitle']);

/**
 * Claves cuyo valor se ignora aunque sea texto largo.
 *
 * Son campos que en estos payloads llevan URLs, rutas, CSS o identificadores:
 * texto largo que no es prosa y que sólo ensuciaría la salida.
 */
const IGNORED_KEYS = new Set([
  'url',
  'href',
  'src',
  'image',
  'thumbnail',
  'logo',
  'id',
  '@id',
  '@context',
  'class',
  'classname',
  'style',
  'css',
  'script',
  'buildid',
  'hash',
  'token',
  'key',
  'slug',
  'path',
  'pathname',
  'route',
  'asset',
  'preload',
]);

/**
 * Recoge del documento los scripts que podrían llevar datos embebidos.
 *
 * Hay que llamarla **antes** de `cleanDocument`, que elimina los `<script>`.
 * Se filtra aquí para quedarnos sólo con lo que sabemos leer y no arrastrar en
 * memoria el resto de scripts de la página.
 */
export function collectHydrationScripts(root: HTMLElement): HydrationScripts {
  const jsonLd: string[] = [];
  const nextData: string[] = [];
  const nextFlight: string[] = [];
  const nuxt: string[] = [];

  let scripts: HTMLElement[];
  try {
    scripts = root.querySelectorAll('script');
  } catch {
    return { jsonLd, nextData, nextFlight, nuxt };
  }

  for (const script of scripts) {
    const type = (script.getAttribute('type') ?? '').toLowerCase();
    const id = script.getAttribute('id') ?? '';
    const content = script.text;

    if (content.length === 0 || content.length > MAX_PAYLOAD_CHARS) continue;

    if (type.includes('ld+json')) {
      jsonLd.push(content);
    } else if (id === '__NEXT_DATA__') {
      nextData.push(content);
    } else if (content.includes('__next_f')) {
      nextFlight.push(content);
    } else if (content.includes('__NUXT__')) {
      nuxt.push(content);
    }
  }

  return { jsonLd, nextData, nextFlight, nuxt };
}

/**
 * Intenta rescatar contenido legible de los scripts recogidos.
 *
 * Prueba las fuentes en orden de fiabilidad y devuelve la primera que dé algo
 * aprovechable, o `null` si ninguna aplica.
 */
export function extractHydratedContent(scripts: HydrationScripts): HydratedContent | null {
  const attempts: readonly (readonly [HydrationSource, () => string | null])[] = [
    ['json-ld', () => fromJsonLd(scripts.jsonLd)],
    ['next-data', () => fromNextData(scripts.nextData)],
    ['next-flight', () => fromNextFlight(scripts.nextFlight)],
    ['nuxt', () => fromNuxt(scripts.nuxt)],
  ];

  for (const [source, run] of attempts) {
    let markdown: string | null = null;
    try {
      markdown = run();
    } catch {
      // Un payload roto no puede tumbar la conversión: se prueba el siguiente.
      markdown = null;
    }
    if (markdown !== null && markdown.trim().length > 0) {
      return { source, markdown: markdown.trim() };
    }
  }

  return null;
}

// --- Fuentes -----------------------------------------------------------------

/** JSON-LD de schema.org. Es el formato más fiable, y por eso va primero. */
function fromJsonLd(payloads: readonly string[]): string | null {
  for (const payload of payloads) {
    const data = parseJsonSafely(payload);
    if (data === null) continue;

    // Un mismo bloque puede traer un objeto, un array o un `@graph`.
    for (const node of flattenJsonLdNodes(data)) {
      const rendered = renderJsonLdNode(node);
      if (rendered !== null) return rendered;
    }
  }
  return null;
}

/** Devuelve los nodos candidatos de un bloque JSON-LD, aplanando `@graph`. */
function flattenJsonLdNodes(data: unknown): unknown[] {
  const nodes: unknown[] = [];
  const queue: unknown[] = Array.isArray(data) ? [...data] : [data];

  while (queue.length > 0 && nodes.length < 50) {
    const item = queue.shift();
    if (!isRecord(item)) continue;
    const graph = item['@graph'];
    if (Array.isArray(graph)) {
      queue.push(...graph);
      continue;
    }
    nodes.push(item);
  }
  return nodes;
}

/** Convierte un nodo JSON-LD en Markdown, si lleva contenido de artículo. */
function renderJsonLdNode(node: unknown): string | null {
  if (!isRecord(node)) return null;

  const title = firstString(node, ['headline', 'name', 'alternativeHeadline']);
  const body = firstString(node, ['articleBody', 'text', 'description', 'abstract']);

  if (body === null && title === null) return null;

  const parts: string[] = [];
  if (title !== null) parts.push(`# ${title}`);
  if (body !== null && body !== title) parts.push(body);

  // Sin cuerpo, un título suelto no compensa: quedaría peor que no hacer nada.
  if (body === null) return null;

  return parts.join('\n\n');
}

/** `__NEXT_DATA__`: Next.js con Pages Router. Un JSON único y bien formado. */
function fromNextData(payloads: readonly string[]): string | null {
  for (const payload of payloads) {
    const data = parseJsonSafely(payload);
    if (data === null) continue;

    // El contenido de la página vive bajo `props.pageProps`; si no está, se
    // recorre el objeto entero, que tampoco es tan grande.
    const props = isRecord(data) ? data['props'] : null;
    const pageProps = isRecord(props) ? props['pageProps'] : null;
    const scope = pageProps ?? data;

    const rendered = renderUnknownJson(scope);
    if (rendered !== null) return rendered;
  }
  return null;
}

/**
 * `self.__next_f.push(...)`: Next.js con App Router (React Server Components).
 *
 * El payload llega troceado en muchas llamadas y con el texto escapado dentro
 * de una cadena JSON. Se reconstruye concatenando los trozos y luego se rescata
 * la prosa que se pueda: el formato del flujo RSC no es público ni estable, así
 * que no se intenta interpretarlo, sólo leer lo que claramente es texto.
 */
function fromNextFlight(payloads: readonly string[]): string | null {
  const chunks: string[] = [];

  for (const payload of payloads) {
    let index = payload.indexOf('__next_f.push(');
    while (index !== -1 && chunks.length < MAX_PROSE_BLOCKS * 4) {
      const quote = payload.indexOf('"', index);
      if (quote === -1) break;
      const literal = readJsonStringLiteral(payload, quote);
      if (literal !== null) chunks.push(literal);
      index = payload.indexOf('__next_f.push(', index + 1);
    }
  }

  if (chunks.length === 0) return null;
  return renderProse(collectProseFromFlight(chunks.join('')));
}

/** `window.__NUXT__`: sólo se aprovecha cuando el valor resulta ser JSON. */
function fromNuxt(payloads: readonly string[]): string | null {
  for (const payload of payloads) {
    const marker = payload.indexOf('__NUXT__');
    if (marker === -1) continue;

    const equals = payload.indexOf('=', marker);
    if (equals === -1) continue;

    // Nuxt a veces emite una función autoejecutada en vez de un objeto; en ese
    // caso `JSON.parse` falla y se abandona sin más, que es lo correcto: no
    // vamos a evaluar JavaScript para averiguarlo.
    const raw = payload.slice(equals + 1).trim().replace(/;\s*$/, '');
    const data = parseJsonSafely(raw);
    if (data === null) continue;

    const rendered = renderUnknownJson(data);
    if (rendered !== null) return rendered;
  }
  return null;
}

// --- Utilidades de lectura ---------------------------------------------------

/** `JSON.parse` que devuelve `null` en vez de lanzar. */
function parseJsonSafely(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PAYLOAD_CHARS) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/**
 * Lee una cadena JSON literal que empieza en `start` (la comilla de apertura).
 *
 * Se hace a mano y no con una expresión regular porque hay que respetar las
 * comillas escapadas: `"...\"..."` es una sola cadena, no dos.
 */
function readJsonStringLiteral(text: string, start: number): string | null {
  if (text[start] !== '"') return null;

  let end = start + 1;
  while (end < text.length) {
    const char = text[end];
    if (char === '\\') {
      end += 2;
      continue;
    }
    if (char === '"') {
      try {
        return JSON.parse(text.slice(start, end + 1)) as string;
      } catch {
        return null;
      }
    }
    end += 1;
  }
  return null;
}

/** Indica si un valor es un objeto plano (y no `null` ni un array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Primera clave presente cuyo valor sea una cadena con contenido. */
function firstString(node: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = node[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Indica si una cadena parece prosa y no un identificador o una ruta. */
function looksLikeProse(value: string): boolean {
  if (value.length < MIN_PROSE_CHARS) return false;
  // Sin espacios no es una frase: será un hash, una ruta o un token.
  if (!value.includes(' ')) return false;
  if (/^https?:\/\//i.test(value)) return false;
  // Descarta CSS y fragmentos de código, frecuentes en estos payloads.
  if (/[{}]\s*[\w-]+\s*:/.test(value)) return false;
  return true;
}

/**
 * Recorre un JSON desconocido reuniendo el título y los fragmentos de prosa.
 *
 * Es el camino para `__NEXT_DATA__` y Nuxt, donde la forma del objeto depende
 * enteramente de la aplicación y no hay un esquema al que agarrarse.
 */
function renderUnknownJson(data: unknown): string | null {
  let title: string | null = null;
  const prose: string[] = [];
  const seen = new Set<string>();

  const walk = (value: unknown, depth: number, key: string): void => {
    if (depth > MAX_DEPTH || prose.length >= MAX_PROSE_BLOCKS) return;

    if (typeof value === 'string') {
      const normalizedKey = key.toLowerCase();
      if (title === null && TITLE_KEYS.has(normalizedKey) && value.trim().length > 0) {
        title = value.trim();
        return;
      }
      if (IGNORED_KEYS.has(normalizedKey)) return;
      const text = value.trim();
      if (looksLikeProse(text) && !seen.has(text)) {
        seen.add(text);
        prose.push(text);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1, key);
      return;
    }

    if (isRecord(value)) {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, depth + 1, childKey);
      }
    }
  };

  walk(data, 0, '');

  if (prose.length === 0) return null;
  return renderProse(prose, title);
}

/** Rescata los fragmentos de prosa de un flujo RSC ya reconstruido. */
function collectProseFromFlight(stream: string): string[] {
  const prose: string[] = [];
  const seen = new Set<string>();

  // El flujo es una sucesión de literales JSON; se recorren buscando los que
  // parezcan texto de verdad.
  let index = stream.indexOf('"');
  while (index !== -1 && prose.length < MAX_PROSE_BLOCKS) {
    const literal = readJsonStringLiteral(stream, index);
    if (literal === null) {
      index = stream.indexOf('"', index + 1);
      continue;
    }
    const text = literal.trim();
    if (looksLikeProse(text) && !seen.has(text)) {
      seen.add(text);
      prose.push(text);
    }
    // Se salta la cadena entera para no releer su interior.
    index = stream.indexOf('"', index + literal.length + 2);
  }

  return prose;
}

/** Compone el Markdown final a partir del título y los fragmentos. */
function renderProse(prose: readonly string[], title: string | null = null): string | null {
  if (prose.length === 0) return null;
  const parts: string[] = [];
  if (title !== null && title.length > 0) parts.push(`# ${title}`);
  parts.push(...prose);
  return parts.join('\n\n');
}
