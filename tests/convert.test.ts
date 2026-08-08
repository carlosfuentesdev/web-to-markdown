import { describe, it, expect } from 'vitest';
import { convertHtml, convertUrl, MAX_PARSE_BYTES } from '../src/convert/convert.js';
import { isConvertError } from '../src/convert/errors.js';
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

  it('rechaza con ConvertError("too_large") un documento que supera MAX_PARSE_BYTES', () => {
    // Reproduce el patrón patológico real encontrado en la auditoría de
    // robustez (2026-08-05): texto casi sin etiquetas HTML, del tamaño que
    // agotó los límites de recursos del Worker en Cloudflare al parsear
    // gutenberg.org/cache/epub/2000/pg2000.txt (2.12 MB). No depende de red:
    // es un HTML sintético que reproduce el mismo patrón (mucho texto plano,
    // pocas etiquetas) por encima del límite.
    const pathologicalHtml =
      '<html><body>' + 'relleno de texto sin etiquetas. '.repeat(80_000) + '</body></html>';
    expect(Buffer.byteLength(pathologicalHtml, 'utf-8')).toBeGreaterThan(MAX_PARSE_BYTES);

    try {
      convertHtml(pathologicalHtml);
      expect.unreachable('convertHtml debería haber lanzado ConvertError');
    } catch (error) {
      expect(isConvertError(error)).toBe(true);
      if (isConvertError(error)) expect(error.code).toBe('too_large');
    }
  });

  it('procesa sin problema un documento justo por debajo de MAX_PARSE_BYTES', () => {
    // Guarda contra falsos positivos: el límite no debe rechazar contenido
    // legítimo que cabe cómodamente por debajo del umbral.
    const relleno = 'x'.repeat(MAX_PARSE_BYTES - 1000);
    const html = `<article><p>${relleno}</p></article>`;
    expect(Buffer.byteLength(html, 'utf-8')).toBeLessThan(MAX_PARSE_BYTES);

    const { markdown } = convertHtml(html);
    expect(markdown.length).toBeGreaterThan(0);
  });
});
