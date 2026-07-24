/**
 * Extracción de metadatos de la página.
 *
 * Lee la cabecera del documento ORIGINAL (antes de podarlo): título, descripción,
 * URL canónica y fecha de publicación de las etiquetas `<meta>`, Open Graph y
 * `<time>`. El recuento de palabras y tokens se calcula sobre el Markdown final.
 */

import type { HTMLElement } from 'node-html-parser';
import type { Metadata } from './types.js';
import { countWords, estimateTokens, readingTimeMinutes } from './tokens.js';

/** Deriva los metadatos del documento y del Markdown resultante. */
export function extractMetadata(
  root: HTMLElement,
  markdown: string,
  baseUrl: string | undefined,
): Metadata {
  const wordCount = countWords(markdown);

  return {
    title: extractTitle(root),
    description: metaContent(root, [
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]),
    canonicalUrl: extractCanonical(root, baseUrl),
    publishedAt: extractPublishedAt(root),
    wordCount,
    estimatedTokens: estimateTokens(markdown),
    readingTimeMinutes: readingTimeMinutes(wordCount),
  };
}

/** Título: Open Graph, `<title>` o el primer `<h1>`, por este orden. */
function extractTitle(root: HTMLElement): string | null {
  const meta = metaContent(root, [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
  ]);
  if (meta !== null) return meta;

  const title = root.querySelector('title')?.text.trim();
  if (title !== undefined && title.length > 0) return title;

  const h1 = root.querySelector('h1')?.text.trim();
  if (h1 !== undefined && h1.length > 0) return h1;

  return null;
}

/** URL canónica: `link[rel=canonical]` u `og:url`, resuelta contra la base. */
function extractCanonical(root: HTMLElement, baseUrl: string | undefined): string | null {
  const link = root.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim();
  const candidate =
    link !== undefined && link.length > 0
      ? link
      : metaContent(root, ['meta[property="og:url"]']);

  if (candidate === null || candidate.length === 0) return null;
  if (baseUrl === undefined) return candidate;
  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return candidate;
  }
}

/** Fecha de publicación normalizada a ISO 8601, si se detecta. */
function extractPublishedAt(root: HTMLElement): string | null {
  const fromMeta = metaContent(root, [
    'meta[property="article:published_time"]',
    'meta[itemprop="datePublished"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
  ]);

  const fromTime = root.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() ?? null;
  const raw = fromMeta ?? fromTime;
  if (raw === null || raw.length === 0) return null;

  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? raw : new Date(timestamp).toISOString();
}

/** Devuelve el `content` del primer selector que exista y no esté vacío. */
function metaContent(root: HTMLElement, selectors: readonly string[]): string | null {
  for (const selector of selectors) {
    const content = root.querySelector(selector)?.getAttribute('content')?.trim();
    if (content !== undefined && content.length > 0) return content;
  }
  return null;
}
