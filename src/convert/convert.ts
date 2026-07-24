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
import { extractMetadata } from './metadata.js';
import { renderMarkdown } from './markdown.js';
import { shrink } from './shrink.js';
import { fetchHtml, type FetchHtmlOptions } from './fetch.js';
import type { ConvertOptions, ConvertResult } from './types.js';

/**
 * Elementos cuyo contenido `node-html-parser` captura como texto crudo (no parsea
 * su interior como HTML). Mantenemos `script`/`style`/`noscript` —así un `<` sin
 * escapar en un script no rompe el parseo, y de todos modos la poda los elimina—
 * pero **excluimos `<pre>` a propósito** (el default de la librería lo incluye):
 * si no, el `<code>` interno se quedaría como texto literal y perderíamos tanto el
 * bloque de código como la detección de lenguaje.
 */
const BLOCK_TEXT_ELEMENTS = { script: true, noscript: true, style: true } as const;

/** Convierte HTML plano en Markdown limpio y denso. */
export function convertHtml(html: string, options: ConvertOptions = {}): ConvertResult {
  const root = parse(html, { comment: false, blockTextElements: BLOCK_TEXT_ELEMENTS });

  // Los metadatos se leen de `<head>` (`<meta>`, `<title>`, `<link>`), que la
  // poda deja intacto; por eso da igual extraerlos antes o después de limpiar.
  cleanDocument(root);
  const main = pickMainContent(root);

  const markdown = shrink(
    renderMarkdown(main, {
      includeImages: options.includeImages ?? false,
      baseUrl: options.baseUrl,
    }),
  );

  const metadata =
    options.extractMetadata === true ? extractMetadata(root, markdown, options.baseUrl) : null;

  return { markdown, metadata };
}

/** Opciones de {@link convertUrl}: las de conversión más las de descarga. */
export type ConvertUrlOptions = ConvertOptions & FetchHtmlOptions;

/** Descarga una URL y la convierte en Markdown. */
export async function convertUrl(url: string, options: ConvertUrlOptions = {}): Promise<ConvertResult> {
  const page = await fetchHtml(url, options);
  // La URL final (tras redirecciones) es la mejor base para resolver enlaces
  // relativos, salvo que quien llama imponga otra.
  return convertHtml(page.html, { ...options, baseUrl: options.baseUrl ?? page.url });
}
