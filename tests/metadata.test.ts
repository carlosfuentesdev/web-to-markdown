import { describe, it, expect } from 'vitest';
import { convertHtml } from '../src/convert/convert.js';

const PAGE = `<!doctype html>
<html>
<head>
  <title>Título de la etiqueta</title>
  <meta property="og:title" content="Título Open Graph">
  <meta name="description" content="La descripción.">
  <meta property="article:published_time" content="2026-07-01T10:00:00Z">
  <link rel="canonical" href="/articulo-canonico">
</head>
<body><article><h1>Encabezado</h1><p>${'palabra '.repeat(50)}</p></article></body>
</html>`;

describe('extracción de metadatos', () => {
  it('devuelve null cuando no se piden', () => {
    expect(convertHtml(PAGE).metadata).toBeNull();
  });

  it('extrae título (Open Graph), descripción, canónica y fecha', () => {
    const { metadata } = convertHtml(PAGE, {
      extractMetadata: true,
      baseUrl: 'https://ejemplo.com/blog/',
    });
    expect(metadata).not.toBeNull();
    expect(metadata?.title).toBe('Título Open Graph');
    expect(metadata?.description).toBe('La descripción.');
    expect(metadata?.canonicalUrl).toBe('https://ejemplo.com/articulo-canonico');
    expect(metadata?.publishedAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('calcula palabras, tokens y tiempo de lectura sobre el Markdown', () => {
    const { metadata } = convertHtml(PAGE, { extractMetadata: true });
    expect(metadata?.wordCount).toBeGreaterThan(40);
    expect(metadata?.estimatedTokens).toBeGreaterThan(0);
    expect(metadata?.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it('recurre a <title> cuando no hay Open Graph', () => {
    const html = '<head><title>Solo title</title></head><body><article><p>x</p></article></body>';
    const { metadata } = convertHtml(html, { extractMetadata: true });
    expect(metadata?.title).toBe('Solo title');
  });
});
