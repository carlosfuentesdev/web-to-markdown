import { describe, it, expect } from 'vitest';
import { fetchHtml, type FetchLike } from '../src/convert/fetch.js';
import { isConvertError, type ConvertErrorCode } from '../src/convert/errors.js';

/** Devuelve un `fetch` falso que responde siempre con la respuesta dada. */
function stubFetch(response: Response): FetchLike {
  return () => Promise.resolve(response);
}

/** Ejecuta `fetchHtml` y devuelve el `code` del `ConvertError` que lance. */
async function codeOf(promise: Promise<unknown>): Promise<ConvertErrorCode | 'no-error'> {
  try {
    await promise;
    return 'no-error';
  } catch (error) {
    return isConvertError(error) ? error.code : 'no-error';
  }
}

describe('fetchHtml', () => {
  it('descarga y devuelve el HTML y la URL', async () => {
    const html = '<html><body><p>hola</p></body></html>';
    const page = await fetchHtml('https://ejemplo.com', {
      fetchImpl: stubFetch(new Response(html, { headers: { 'content-type': 'text/html' } })),
    });
    expect(page.html).toBe(html);
    expect(page.url).toBe('https://ejemplo.com/');
  });

  it('rechaza URLs no válidas', async () => {
    expect(await codeOf(fetchHtml('esto no es una url'))).toBe('invalid_url');
  });

  it('rechaza protocolos que no son http(s)', async () => {
    expect(await codeOf(fetchHtml('ftp://ejemplo.com/x'))).toBe('unsupported_protocol');
  });

  it('rechaza contenido que no es HTML', async () => {
    const code = await codeOf(
      fetchHtml('https://ejemplo.com/datos.json', {
        fetchImpl: stubFetch(new Response('{}', { headers: { 'content-type': 'application/json' } })),
      }),
    );
    expect(code).toBe('not_html');
  });

  it('propaga los errores HTTP de la página', async () => {
    const code = await codeOf(
      fetchHtml('https://ejemplo.com/404', {
        fetchImpl: stubFetch(new Response('no', { status: 404, headers: { 'content-type': 'text/html' } })),
      }),
    );
    expect(code).toBe('http_error');
  });

  it('rechaza páginas por encima del límite de tamaño', async () => {
    const big = 'x'.repeat(5_000);
    const code = await codeOf(
      fetchHtml('https://ejemplo.com/grande', {
        maxBytes: 100,
        fetchImpl: stubFetch(new Response(big, { headers: { 'content-type': 'text/html' } })),
      }),
    );
    expect(code).toBe('too_large');
  });

  it('rechaza contenido vacío', async () => {
    const code = await codeOf(
      fetchHtml('https://ejemplo.com/vacio', {
        fetchImpl: stubFetch(new Response('   ', { headers: { 'content-type': 'text/html' } })),
      }),
    );
    expect(code).toBe('empty_content');
  });

  it('traduce un fallo de red a fetch_failed', async () => {
    const code = await codeOf(
      fetchHtml('https://ejemplo.com', {
        fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
      }),
    );
    expect(code).toBe('fetch_failed');
  });

  it('decodifica con el charset declarado en Content-Type en vez de forzar UTF-8', async () => {
    // Hallazgo 3 de la auditoría de robustez (2026-08-05): confirmado en
    // producción con lib.ru (charset=koi8-r), que salía como caracteres de
    // reemplazo. Aquí se reproduce el mismo patrón con ISO-8859-1 (ñ, á, é,
    // ó son bytes fuera de ASCII en ese charset), sin depender de una URL
    // externa: bytes crudos en ISO-8859-1, no una cadena JS reencodeada.
    const textoOriginal = '<html><body><p>Café, niño, corazón.</p></body></html>';
    const bytesIso88591 = Buffer.from(textoOriginal, 'latin1');

    const page = await fetchHtml('https://ejemplo.com/latin1', {
      fetchImpl: stubFetch(
        new Response(bytesIso88591, {
          headers: { 'content-type': 'text/html; charset=iso-8859-1' },
        }),
      ),
    });

    expect(page.html).toBe(textoOriginal);
    expect(page.html).not.toContain('�'); // carácter de reemplazo Unicode
  });

  it('cae a UTF-8 si el charset declarado no existe o no es reconocido', async () => {
    // No hacemos detección heurística: si el servidor declara un charset que
    // el runtime no reconoce, no lo adivinamos — nos quedamos con el
    // comportamiento de siempre (UTF-8), sin empeorarlo.
    const html = '<html><body><p>Café, niño, corazón.</p></body></html>';
    const page = await fetchHtml('https://ejemplo.com/charset-invalido', {
      fetchImpl: stubFetch(
        new Response(html, {
          headers: { 'content-type': 'text/html; charset=no-existe-este-charset' },
        }),
      ),
    });

    expect(page.html).toBe(html);
  });
});
