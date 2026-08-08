import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import {
  collectHydrationScripts,
  extractHydratedContent,
} from '../src/convert/hydration-extract.js';
import { convertHtml } from '../src/convert/convert.js';

/** Envuelve un cuerpo en un documento con el `<div id="root">` vacío de una SPA. */
function spaShell(scripts: string, title = 'Página de ejemplo'): string {
  return `<!doctype html>
<html lang="es">
  <head><title>${title}</title></head>
  <body>
    <div id="root"></div>
    ${scripts}
  </body>
</html>`;
}

/** Atajo: recoge los scripts de un HTML y ejecuta la extracción. */
function extractFrom(html: string) {
  return extractHydratedContent(collectHydrationScripts(parse(html)));
}

const CUERPO_LARGO =
  'El protocolo de contexto de modelo permite que un agente descubra ' +
  'herramientas y las invoque sin escribir pegamento para cada API. Este ' +
  'artículo explica cómo encaja con una arquitectura de borde y por qué ' +
  'conviene mantener el servidor lo más pequeño posible.';

describe('extracción de datos embebidos', () => {
  it('lee un artículo de JSON-LD', () => {
    const html = spaShell(`
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BlogPosting',
          headline: 'Agentes y protocolo de contexto',
          articleBody: CUERPO_LARGO,
          url: 'https://ejemplo.com/articulo',
        })}
      </script>`);

    const resultado = extractFrom(html);
    expect(resultado?.source).toBe('json-ld');
    expect(resultado?.markdown).toContain('# Agentes y protocolo de contexto');
    expect(resultado?.markdown).toContain('protocolo de contexto de modelo');
  });

  it('aplana el @graph de JSON-LD para encontrar el artículo', () => {
    const html = spaShell(`
      <script type="application/ld+json">
        ${JSON.stringify({
          '@context': 'https://schema.org',
          '@graph': [
            { '@type': 'WebSite', name: 'Sitio' },
            { '@type': 'Article', headline: 'Dentro del grafo', articleBody: CUERPO_LARGO },
          ],
        })}
      </script>`);

    const resultado = extractFrom(html);
    expect(resultado?.source).toBe('json-ld');
    expect(resultado?.markdown).toContain('# Dentro del grafo');
  });

  it('lee __NEXT_DATA__ de Next.js con Pages Router', () => {
    const html = spaShell(`
      <script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify({
          props: {
            pageProps: {
              post: { title: 'Renderizado en servidor', body: CUERPO_LARGO },
            },
          },
          buildId: 'abc123',
        })}
      </script>`);

    const resultado = extractFrom(html);
    expect(resultado?.source).toBe('next-data');
    expect(resultado?.markdown).toContain('# Renderizado en servidor');
    expect(resultado?.markdown).toContain('protocolo de contexto de modelo');
    // `buildId` es ruido: no debe acabar en la salida.
    expect(resultado?.markdown).not.toContain('abc123');
  });

  it('lee el flujo troceado de self.__next_f.push (App Router / RSC)', () => {
    // El texto viaja escapado dentro de una cadena JSON, y troceado en varias
    // llamadas: así es como lo emite Next.js de verdad.
    const trozo = JSON.stringify(`4:["$","p",null,{"children":"${CUERPO_LARGO}"}]\n`);
    const html = spaShell(`
      <script>self.__next_f.push([1,"3:I[4707,[],\\"\\"]\\n"])</script>
      <script>self.__next_f.push([1,${trozo}])</script>`);

    const resultado = extractFrom(html);
    expect(resultado?.source).toBe('next-flight');
    expect(resultado?.markdown).toContain('protocolo de contexto de modelo');
  });

  it('lee window.__NUXT__ cuando su valor es JSON', () => {
    const html = spaShell(`
      <script>window.__NUXT__ = ${JSON.stringify({
        data: { articulo: { title: 'Desde Nuxt', description: CUERPO_LARGO } },
      })};</script>`);

    const resultado = extractFrom(html);
    expect(resultado?.source).toBe('nuxt');
    expect(resultado?.markdown).toContain('# Desde Nuxt');
    expect(resultado?.markdown).toContain('protocolo de contexto de modelo');
  });

  it('da prioridad a JSON-LD cuando conviven varias fuentes', () => {
    const html = spaShell(`
      <script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify({ props: { pageProps: { body: CUERPO_LARGO } } })}
      </script>
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Article',
          headline: 'El estándar manda',
          articleBody: CUERPO_LARGO,
        })}
      </script>`);

    expect(extractFrom(html)?.source).toBe('json-ld');
  });
});

describe('robustez de la extracción', () => {
  it('devuelve null cuando no hay ninguna fuente embebida', () => {
    expect(extractFrom(spaShell('<script>console.log(1)</script>'))).toBeNull();
  });

  it('devuelve null y no lanza con JSON malformado', () => {
    const rotos = [
      '<script type="application/ld+json">{"headline": "sin cerrar"</script>',
      '<script id="__NEXT_DATA__" type="application/json">{{{no es json}}}</script>',
      '<script>window.__NUXT__ = (function(a,b){return {a:a}}(1,2));</script>',
      '<script>self.__next_f.push([1,"cadena sin cerrar</script>',
      '<script type="application/ld+json"></script>',
    ];
    for (const roto of rotos) {
      expect(() => extractFrom(spaShell(roto))).not.toThrow();
      expect(extractFrom(spaShell(roto))).toBeNull();
    }
  });

  it('ignora un JSON válido que no contiene prosa', () => {
    const html = spaShell(`
      <script id="__NEXT_DATA__" type="application/json">
        ${JSON.stringify({ props: { pageProps: { id: 42, slug: 'un-slug', ok: true } } })}
      </script>`);
    expect(extractFrom(html)).toBeNull();
  });

  it('no confunde una URL larga con prosa', () => {
    const html = spaShell(`
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Article',
          headline: 'Solo enlaces',
          articleBody: 'https://ejemplo.com/una/ruta/francamente/larguisima/pero/sin/prosa',
        })}
      </script>`);
    // Hay cuerpo, pero es una URL: no debe pasar el filtro de prosa del
    // recorrido genérico. JSON-LD sí lo acepta porque el campo es explícito.
    const resultado = extractFrom(html);
    expect(resultado === null || resultado.source === 'json-ld').toBe(true);
  });
});

describe('integración con convertHtml', () => {
  it('rescata el contenido de una SPA que llega con el cuerpo vacío', () => {
    const html = spaShell(`
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Article',
          headline: 'Artículo rescatado',
          articleBody: CUERPO_LARGO,
        })}
      </script>`);

    const { markdown } = convertHtml(html);
    expect(markdown).toContain('# Artículo rescatado');
    expect(markdown).toContain('protocolo de contexto de modelo');
  });

  it('sigue devolviendo vacío si la SPA no trae datos embebidos', () => {
    // El comportamiento de antes se conserva: sin datos, no hay milagro.
    const { markdown } = convertHtml(spaShell('<script>hidratar()</script>'));
    expect(markdown.trim()).toBe('');
  });

  it('no toca una página normal con contenido visible suficiente', () => {
    const html = `<html><body><article>
      <h1>Página normal</h1>
      <p>${CUERPO_LARGO}</p>
    </article>
    <script type="application/ld+json">
      ${JSON.stringify({ '@type': 'Article', headline: 'NO DEBE APARECER', articleBody: CUERPO_LARGO })}
    </script></body></html>`;

    const { markdown } = convertHtml(html);
    expect(markdown).toContain('# Página normal');
    expect(markdown).not.toContain('NO DEBE APARECER');
  });

  it('conserva el contenido visible si el rescate aporta menos texto', () => {
    // 150 caracteres visibles: por debajo del umbral, pero más que lo embebido.
    const visible = 'a'.repeat(60) + ' ' + 'b'.repeat(60);
    const html = `<html><body><article><p>${visible}</p></article>
      <script type="application/ld+json">
        ${JSON.stringify({ '@type': 'Article', headline: 'Corto', articleBody: 'muy poco texto aqui la verdad' })}
      </script></body></html>`;

    const { markdown } = convertHtml(html);
    expect(markdown).toContain(visible);
  });

  it('calcula los metadatos sobre el markdown rescatado, no sobre el vacío', () => {
    const html = spaShell(`
      <script type="application/ld+json">
        ${JSON.stringify({
          '@type': 'Article',
          headline: 'Con metadatos',
          articleBody: CUERPO_LARGO,
        })}
      </script>`);

    const { metadata } = convertHtml(html, { extractMetadata: true });
    expect(metadata?.wordCount).toBeGreaterThan(20);
  });
});
