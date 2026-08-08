/**
 * Orquestación del pipeline de conversión.
 *
 * Une los pasos en el orden correcto:
 *   parseo → poda de ruido → selección del cuerpo → Markdown → token shrinkage,
 * y, opcionalmente, extracción de metadatos.
 *
 * `convertHtml` es síncrono (el parseo lo es); `convertUrl` añade delante la
 * descarga de la página con {@link fetchHtml}.
 */

import { parse } from 'node-html-parser';
import { cleanDocument, pickMainContent } from './clean.js';
import { ConvertError } from './errors.js';
import { extractMetadata } from './metadata.js';
import { renderMarkdown } from './markdown.js';
import { shrink } from './shrink.js';
import { fetchHtml, type FetchHtmlOptions } from './fetch.js';
import { collectHydrationScripts, extractHydratedContent } from './hydration-extract.js';
import { validateSafeUrl } from './url-safety.js';
import type { ConvertOptions, ConvertResult } from './types.js';

/**
 * Límite de bytes que nos atrevemos a pasar al analizador HTML.
 *
 * Deliberadamente más bajo que `MAX_RESPONSE_BYTES` (5 MB, el límite de
 * descarga de `fetchHtml`): un documento con muy pocas etiquetas — texto
 * plano servido con `content-type: text/plain` o `text/html`, por ejemplo —
 * puede agotar el presupuesto de CPU/memoria del Worker de Cloudflare bien
 * antes de llegar a 5 MB. Confirmado en producción el 5 de agosto de 2026
 * con un documento real de 2.12 MB de texto casi sin etiquetas
 * (`gutenberg.org/cache/epub/2000/pg2000.txt`): Cloudflare mató el Worker
 * por "Worker exceeded resource limits" (error 1102) antes de que nuestro
 * código pudiera devolver un error controlado — el cliente recibió HTML de
 * error en inglés con el Ray ID, no el sobre JSON habitual.
 *
 * Esta comprobación corre ANTES de llamar a `parse()`, para no entrar
 * siquiera en la zona de riesgo. Se aplica tanto a `convertHtml` como a
 * `convertUrl` (que delega en `convertHtml`), así que cubre el HTML tanto si
 * llega por `url` como si llega inline en el cuerpo de la petición.
 */
export const MAX_PARSE_BYTES = 2 * 1024 * 1024;

/**
 * Elementos cuyo contenido `node-html-parser` captura como texto crudo (no parsea
 * su interior como HTML). Mantenemos `script`/`style`/`noscript` —así un `<` sin
 * escapar en un script no rompe el parseo, y de todos modos la poda los elimina—
 * pero **excluimos `<pre>` a propósito** (el default de la librería lo incluye):
 * si no, el `<code>` interno se quedaría como texto literal y perderíamos tanto el
 * bloque de código como la detección de lenguaje.
 */
const BLOCK_TEXT_ELEMENTS = { script: true, noscript: true, style: true } as const;

/**
 * Umbral por debajo del cual se considera que la página no dio contenido.
 *
 * Es el mismo criterio de "esto está vacío" que ya usa `pickMainContent` para
 * descartar un `<article>` decorativo. Por debajo de aquí merece la pena mirar
 * si el framework dejó los datos embebidos en un `<script>`.
 */
export const MIN_VISIBLE_MARKDOWN_CHARS = 200;

/** Convierte HTML plano en Markdown limpio y denso. */
export function convertHtml(html: string, options: ConvertOptions = {}): ConvertResult {
  const byteLength = new TextEncoder().encode(html).length;
  if (byteLength > MAX_PARSE_BYTES) {
    throw new ConvertError(
      'too_large',
      `El HTML supera el límite de ${Math.floor(MAX_PARSE_BYTES / (1024 * 1024))} MB que admite el analizador.`,
    );
  }

  const root = parse(html, { comment: false, blockTextElements: BLOCK_TEXT_ELEMENTS });

  // Se recogen antes de podar: `cleanDocument` elimina los `<script>`, y para
  // cuando sabemos si hacen falta ya no quedaría ninguno en el árbol.
  const hydrationScripts = collectHydrationScripts(root);

  // Los metadatos se leen de `<head>` (`<meta>`, `<title>`, `<link>`), que la
  // poda deja intacto; por eso da igual extraerlos antes o después de limpiar.
  cleanDocument(root);
  const main = pickMainContent(root);

  const visibleMarkdown = shrink(
    renderMarkdown(main, {
      includeImages: options.includeImages ?? false,
      baseUrl: options.baseUrl,
    }),
  );

  const markdown = withHydrationFallback(visibleMarkdown, hydrationScripts);

  const metadata =
    options.extractMetadata === true ? extractMetadata(root, markdown, options.baseUrl) : null;

  return { markdown, metadata };
}

/**
 * Devuelve el Markdown visible o, si vino casi vacío, el rescatado del HTML.
 *
 * Sólo sustituye cuando el rescate aporta **más** texto que lo visible: una
 * página corta pero legítima no debe perder su contenido a cambio de fragmentos
 * sueltos sacados de un JSON.
 */
function withHydrationFallback(
  visibleMarkdown: string,
  scripts: ReturnType<typeof collectHydrationScripts>,
): string {
  if (visibleMarkdown.length >= MIN_VISIBLE_MARKDOWN_CHARS) return visibleMarkdown;

  const hydrated = extractHydratedContent(scripts);
  if (hydrated === null) return visibleMarkdown;
  if (hydrated.markdown.length <= visibleMarkdown.length) return visibleMarkdown;

  return shrink(hydrated.markdown);
}

/** Opciones de {@link convertUrl}: las de conversión más las de descarga. */
export type ConvertUrlOptions = ConvertOptions & FetchHtmlOptions;

/** Descarga una URL y la convierte en Markdown. */
export async function convertUrl(url: string, options: ConvertUrlOptions = {}): Promise<ConvertResult> {
  // Rechazo temprano y sin coste de red de las URLs que apuntan a la red
  // interna. `fetchHtml` vuelve a comprobarlo —y además resuelve el DNS y
  // valida cada redirección—, pero esta llamada corta antes de tocar la red y
  // deja explícito el contrato de la función pública: `convertUrl` nunca pide
  // una URL privada, la use quien la use.
  validateSafeUrl(url);

  const page = await fetchHtml(url, options);
  // La URL final (tras redirecciones) es la mejor base para resolver enlaces
  // relativos, salvo que quien llama imponga otra.
  return convertHtml(page.html, { ...options, baseUrl: options.baseUrl ?? page.url });
}
