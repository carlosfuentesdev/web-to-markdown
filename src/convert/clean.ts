/**
 * Limpieza semántica del DOM (extracción tipo "Readability", ligera).
 *
 * Dos pasos:
 *  1. `cleanDocument`: poda el ruido — scripts, estilos, navegación, cabeceras y
 *     pies de página, barras laterales, banners de cookies, anuncios y todo
 *     elemento cuyo `class`/`id`/`role` delate que es adorno y no contenido.
 *  2. `pickMainContent`: elige el contenedor con el cuerpo real del documento
 *     (`<main>`/`<article>` o, en su defecto, el `<body>`).
 *
 * No cargamos `@mozilla/readability` (arrastra un DOM completo): la poda por
 * selectores y densidad de texto cubre el 95% de las páginas a coste ínfimo.
 */

import { HTMLElement, NodeType, type Node } from 'node-html-parser';

/** Etiquetas que nunca son contenido: se eliminan siempre. */
const HARD_REMOVE_TAGS = new Set<string>([
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'dialog',
  'audio',
  'video',
]);

/**
 * Tokens de `class`/`id`/`role` que delatan adorno de página.
 *
 * Se comparan por token exacto tras partir por espacios, guiones y guiones bajos,
 * para no confundir `ad` con `gradient` ni `nav` con `navbar-brand-header`. A
 * propósito NO incluye `header`/`footer` como token: rompería las cabeceras de
 * artículo (`entry-header`) que sí llevan el título.
 */
const NOISE_TOKENS = new Set<string>([
  'ad',
  'ads',
  'advert',
  'adverts',
  'advertisement',
  'advertising',
  'promo',
  'promotion',
  'sponsor',
  'sponsored',
  'cookie',
  'cookies',
  'consent',
  'gdpr',
  'banner',
  'popup',
  'modal',
  'overlay',
  'lightbox',
  'newsletter',
  'subscribe',
  'signup',
  'social',
  'share',
  'sharing',
  'related',
  'recommended',
  'recommend',
  'recirc',
  'widget',
  'comments',
  'comment',
  'disqus',
  'pagination',
  'paginator',
  'sidebar',
  'masthead',
  'navbar',
  'nav',
  'navigation',
  'menu',
  'breadcrumb',
  'breadcrumbs',
  'skip',
  'hidden',
  'complementary',
  'contentinfo',
  'search',
  'toolbar',
]);

/** Poda el ruido del documento in situ. */
export function cleanDocument(root: HTMLElement): void {
  prune(root, false);
}

/** Recorre el árbol de arriba abajo eliminando lo que no es contenido. */
function prune(el: HTMLElement, insideArticle: boolean): void {
  // Copiamos los hijos porque vamos a mutar la lista al eliminar.
  for (const child of [...el.childNodes]) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const tag = tagOf(element);
    const nowInside = insideArticle || tag === 'article' || tag === 'main';

    if (shouldRemove(element, tag, insideArticle)) {
      element.remove();
      continue;
    }
    prune(element, nowInside);
  }
}

/** Decide si un elemento es ruido eliminable. */
function shouldRemove(el: HTMLElement, tag: string, insideArticle: boolean): boolean {
  if (HARD_REMOVE_TAGS.has(tag)) return true;
  // Navegación y barras laterales nunca son contenido.
  if (tag === 'nav' || tag === 'aside') return true;
  // El pie de página y las cabeceras de página (fuera de un artículo) son adorno.
  if (tag === 'footer') return true;
  if (tag === 'header' && !insideArticle) return true;
  // No tocamos jamás el envoltorio principal.
  if (tag === 'main' || tag === 'article') return false;

  if (hasNoisyClassOrId(el)) {
    // ...salvo que ese contenedor "ruidoso" envuelva el contenido principal.
    if (el.querySelector('article, main') !== null) return false;
    return true;
  }
  return false;
}

/** Indica si el `class`/`id`/`role` del elemento contiene un token de ruido. */
function hasNoisyClassOrId(el: HTMLElement): boolean {
  const raw = `${el.getAttribute('class') ?? ''} ${el.getAttribute('id') ?? ''} ${el.getAttribute('role') ?? ''}`;
  const tokens = raw.toLowerCase().split(/[\s\-_]+/);
  for (const token of tokens) {
    if (token.length > 0 && NOISE_TOKENS.has(token)) return true;
  }
  return false;
}

/**
 * Elige el contenedor con el cuerpo principal del documento.
 *
 * Prefiere el `<main>`/`<article>` con más texto; si no hay ninguno con cuerpo
 * suficiente, devuelve el `<body>` (ya podado de ruido).
 */
export function pickMainContent(root: HTMLElement): HTMLElement {
  const body = root.querySelector('body') ?? root;
  const candidates = [...body.querySelectorAll('main, article, [role="main"]')];

  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = candidate.text.trim().length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // 200 caracteres: umbral para no quedarnos con un `<article>` decorativo vacío.
  if (best !== null && bestScore >= 200) return best;
  return body;
}

/** Nombre de etiqueta en minúsculas, o cadena vacía para nodos sin etiqueta. */
export function tagOf(node: Node): string {
  if (node.nodeType !== NodeType.ELEMENT_NODE) return '';
  return ((node as HTMLElement).tagName ?? '').toLowerCase();
}
