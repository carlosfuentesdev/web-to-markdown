/**
 * Conversión DOM → Markdown.
 *
 * Recorre el árbol ya limpio y emite Markdown semántico: encabezados, listas
 * (anidadas), bloques de código con lenguaje, citas, enlaces, imágenes opcionales
 * y tablas en formato GFM. Los bloques se separan por una línea en blanco; el
 * texto en línea colapsa el espacio en blanco redundante.
 *
 * No escapamos agresivamente los caracteres especiales de Markdown: el destino es
 * la ventana de contexto de un LLM, donde la legibilidad y la densidad importan
 * más que un Markdown estrictamente canónico. Sí escapamos las barras verticales
 * dentro de las celdas de tabla, que romperían la sintaxis GFM.
 */

import { HTMLElement, NodeType, type Node, type TextNode } from 'node-html-parser';
import { tagOf } from './clean.js';

/** Contexto de renderizado que se propaga por el árbol. */
export interface RenderContext {
  /** Emitir imágenes como `![alt](src)`. */
  readonly includeImages: boolean;
  /** URL base para resolver enlaces e imágenes relativos. */
  readonly baseUrl: string | undefined;
}

/** Etiquetas que se tratan como texto en línea, no como bloque. */
const INLINE_TAGS = new Set<string>([
  'a',
  'b',
  'strong',
  'i',
  'em',
  'code',
  'span',
  'small',
  'mark',
  'sub',
  'sup',
  'u',
  'abbr',
  'cite',
  'q',
  'time',
  'label',
  'del',
  's',
  'strike',
  'ins',
  'var',
  'kbd',
  'samp',
  'bdi',
  'bdo',
  'font',
  'img',
]);

/** Convierte el contenido de un elemento a Markdown. */
export function renderMarkdown(root: HTMLElement, context: RenderContext): string {
  return renderContainer(root, context).trim();
}

/**
 * Renderiza los hijos de un contenedor como bloques.
 *
 * Acumula el texto en línea suelto y lo vuelca como párrafo cada vez que aparece
 * un elemento de bloque, de modo que texto y bloques mezclados salgan en orden.
 */
function renderContainer(el: HTMLElement, ctx: RenderContext): string {
  const blocks: string[] = [];
  let inline = '';

  const flush = (): void => {
    const text = collapseInline(inline);
    if (text.length > 0) blocks.push(text);
    inline = '';
  };

  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      inline += textOf(child);
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

    const element = child as HTMLElement;
    const tag = tagOf(element);

    if (tag === 'br') {
      inline += '\n';
      continue;
    }
    if (INLINE_TAGS.has(tag)) {
      inline += renderInline(element, tag, ctx);
      continue;
    }

    flush();
    const block = renderBlock(element, tag, ctx);
    if (block.length > 0) blocks.push(block);
  }

  flush();
  return blocks.join('\n\n');
}

/** Renderiza un elemento de bloque. */
function renderBlock(el: HTMLElement, tag: string, ctx: RenderContext): string {
  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(tag[1]);
      const text = collapseInline(renderInlineChildren(el, ctx));
      return text.length > 0 ? `${'#'.repeat(level)} ${text}` : '';
    }
    case 'p':
    case 'figcaption':
    case 'address':
    case 'dt':
    case 'dd':
      return collapseInline(renderInlineChildren(el, ctx));
    case 'ul':
      return renderList(el, ctx, false);
    case 'ol':
      return renderList(el, ctx, true);
    case 'blockquote':
      return renderBlockquote(el, ctx);
    case 'pre':
      return renderPre(el);
    case 'hr':
      return '---';
    case 'table':
      return renderTable(el, ctx);
    default:
      // div, section, article, main, header, figure, details, dl... son
      // transparentes: se renderiza su contenido.
      return renderContainer(el, ctx);
  }
}

/** Renderiza un elemento en línea (negrita, enlace, código en línea, imagen...). */
function renderInline(el: HTMLElement, tag: string, ctx: RenderContext): string {
  switch (tag) {
    case 'strong':
    case 'b': {
      const text = renderInlineChildren(el, ctx).trim();
      return text.length > 0 ? `**${text}**` : '';
    }
    case 'em':
    case 'i': {
      const text = renderInlineChildren(el, ctx).trim();
      return text.length > 0 ? `*${text}*` : '';
    }
    case 'del':
    case 's':
    case 'strike': {
      const text = renderInlineChildren(el, ctx).trim();
      return text.length > 0 ? `~~${text}~~` : '';
    }
    case 'code': {
      const text = el.text;
      return text.length > 0 ? `\`${text}\`` : '';
    }
    case 'a': {
      const text = renderInlineChildren(el, ctx).trim();
      const href = resolveUrl(el.getAttribute('href'), ctx.baseUrl);
      if (href === null) return text;
      if (text.length === 0) return href;
      return `[${text}](${href})`;
    }
    case 'img': {
      if (!ctx.includeImages) return '';
      const src = resolveUrl(el.getAttribute('src'), ctx.baseUrl);
      if (src === null) return '';
      const alt = (el.getAttribute('alt') ?? '').replace(/[\r\n]+/g, ' ').trim();
      return `![${alt}](${src})`;
    }
    default:
      return renderInlineChildren(el, ctx);
  }
}

/** Concatena el contenido en línea de los hijos de un elemento. */
function renderInlineChildren(el: HTMLElement, ctx: RenderContext): string {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === NodeType.TEXT_NODE) {
      out += textOf(child);
      continue;
    }
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    const tag = tagOf(element);
    if (tag === 'br') {
      out += '\n';
      continue;
    }
    out += renderInline(element, tag, ctx);
  }
  return out;
}

/** Renderiza una lista (`<ul>`/`<ol>`), respetando el anidamiento. */
function renderList(el: HTMLElement, ctx: RenderContext, ordered: boolean): string {
  const items: string[] = [];
  let index = 1;

  for (const child of el.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    if (tagOf(child) !== 'li') continue;

    const marker = ordered ? `${index}. ` : '- ';
    index += 1;

    const content = renderContainer(child as HTMLElement, ctx).trim();
    const lines = content.split('\n');
    const first = lines.shift() ?? '';
    const indent = ' '.repeat(marker.length);

    let item = `${marker}${first}`;
    for (const line of lines) {
      item += line.length > 0 ? `\n${indent}${line}` : '\n';
    }
    items.push(item);
  }

  return items.join('\n');
}

/** Renderiza una cita, prefijando cada línea con `> `. */
function renderBlockquote(el: HTMLElement, ctx: RenderContext): string {
  const inner = renderContainer(el, ctx).trim();
  return inner
    .split('\n')
    .map((line) => (line.length > 0 ? `> ${line}` : '>'))
    .join('\n');
}

/** Renderiza un bloque de código con lenguaje detectado por la clase `language-*`. */
function renderPre(el: HTMLElement): string {
  const code = el.querySelector('code');
  const classAttr = `${code?.getAttribute('class') ?? ''} ${el.getAttribute('class') ?? ''}`;
  const language = /(?:language|lang)-([\w+-]+)/.exec(classAttr)?.[1] ?? '';
  const body = (code ?? el).text.replace(/\n+$/, '');
  // Si el código ya contiene una valla de tres tildes invertidas, alargamos la nuestra.
  const fence = body.includes('```') ? '````' : '```';
  return `${fence}${language}\n${body}\n${fence}`;
}

/** Renderiza una tabla en formato GitHub Flavored Markdown. */
function renderTable(el: HTMLElement, ctx: RenderContext): string {
  const rows = [...el.querySelectorAll('tr')];
  if (rows.length === 0) return '';

  const matrix = rows.map((row) =>
    [...row.querySelectorAll('th, td')].map((cell) =>
      escapeCell(collapseInline(renderInlineChildren(cell, ctx))),
    ),
  );

  const columns = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  if (columns === 0) return '';

  const pad = (row: string[]): string[] => {
    const copy = [...row];
    while (copy.length < columns) copy.push('');
    return copy;
  };

  const toLine = (row: string[]): string => `| ${pad(row).join(' | ')} |`;

  const [header, ...bodyRows] = matrix;
  const lines = [
    toLine(header ?? []),
    `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`,
    ...bodyRows.map(toLine),
  ];
  return lines.join('\n');
}

// --- Utilidades --------------------------------------------------------------

/** Texto decodificado de un nodo de texto. */
function textOf(node: Node): string {
  return (node as TextNode).text ?? '';
}

/**
 * Colapsa el espacio en blanco de un fragmento en línea.
 *
 * Reduce tabuladores y espacios múltiples a uno solo y limpia el espacio en
 * torno a los saltos de línea (que provienen de `<br>`), sin fundir esos saltos.
 */
function collapseInline(text: string): string {
  return text
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Escapa el contenido de una celda de tabla para no romper la sintaxis GFM. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

/** Resuelve una URL relativa contra la base; descarta las vacías o no navegables. */
function resolveUrl(href: string | null | undefined, baseUrl: string | undefined): string | null {
  if (href === null || href === undefined) return null;
  const trimmed = href.trim();
  if (trimmed.length === 0) return null;
  // Anclas internas y pseudo-enlaces no aportan nada al Markdown.
  if (trimmed.startsWith('#') || trimmed.startsWith('javascript:')) return null;
  if (baseUrl === undefined) return trimmed;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}
