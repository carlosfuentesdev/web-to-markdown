import { describe, it, expect } from 'vitest';
import { convertHtml, convertUrl } from '../src/convert/convert.js';
import type { FetchLike } from '../src/convert/fetch.js';

const ARTICLE = `<html>
<head><title>Post</title><meta name="description" content="desc"></head>
<body><article><h1>Hola</h1><p>Un <a href="/rel">enlace relativo</a>.</p></article></body>
</html>`;

function stubFetch(html: string): FetchLike {
  return () => Promise.resolve(new Response(html, { headers: { 'content-type': 'text/html' } }));
}

describe('convertUrl', () => {
  it('descarga, convierte y resuelve enlaces contra la URL final', async () => {
    const { markdown } = await convertUrl('https://ejemplo.com/blog/post', {
      fetchImpl: stubFetch(ARTICLE),
    });
    expect(markdown).toContain('# Hola');
    expect(markdown).toContain('[enlace relativo](https://ejemplo.com/rel)');
  });

  it('extrae metadatos cuando se piden', async () => {
    const { metadata } = await convertUrl('https://ejemplo.com/blog/post', {
      extractMetadata: true,
      fetchImpl: stubFetch(ARTICLE),
    });
    expect(metadata?.title).toBe('Post');
    expect(metadata?.description).toBe('desc');
  });
});

describe('convertHtml', () => {
  it('termina siempre con un único salto de línea', () => {
    const { markdown } = convertHtml('<article><p>x</p></article>');
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
  });

  it('devuelve markdown vacío para un cuerpo sin contenido', () => {
    const { markdown } = convertHtml('<html><head><title>t</title></head><body></body></html>');
    expect(markdown).toBe('');
  });
});
