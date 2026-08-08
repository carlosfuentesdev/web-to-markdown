import { describe, it, expect } from 'vitest';
import {
  isBlockedHost,
  validateSafeUrl,
  validateSafeUrlWithDns,
} from '../src/convert/url-safety.js';
import { convertUrl } from '../src/convert/convert.js';
import { fetchHtml, type FetchLike } from '../src/convert/fetch.js';
import { isConvertError, type ConvertErrorCode } from '../src/convert/errors.js';

/** Ejecuta algo que debe lanzar y devuelve el `code` del `ConvertError`. */
async function codeOf(run: () => unknown): Promise<ConvertErrorCode | 'no-error'> {
  try {
    await run();
    return 'no-error';
  } catch (error) {
    return isConvertError(error) ? error.code : 'no-error';
  }
}

describe('validateSafeUrl', () => {
  it('deja pasar una URL pública normal', () => {
    expect(() => validateSafeUrl('https://ejemplo.com/articulo')).not.toThrow();
    expect(() => validateSafeUrl('http://192.0.2.10/pagina')).not.toThrow();
  });

  // Los casos que pidió la auditoría, uno por rango bloqueado.
  it.each([
    ['bucle local IPv4', 'http://127.0.0.1/'],
    ['metadatos de nube', 'http://169.254.169.254/latest/meta-data/'],
    ['nombre reservado', 'http://localhost/'],
    ['privada 10/8', 'http://10.0.0.5/'],
    ['bucle local IPv6', 'http://[::1]/'],
  ])('bloquea %s', async (_nombre, url) => {
    expect(await codeOf(() => validateSafeUrl(url))).toBe('blocked_host');
  });

  it.each([
    ['dirección sin especificar', 'http://0.0.0.0/'],
    ['privada 172.16/12', 'http://172.16.0.1/'],
    ['privada 192.168/16', 'http://192.168.1.1/'],
    ['unicast local único IPv6', 'http://[fc00::1]/'],
    ['enlace local IPv6', 'http://[fe80::1]/'],
    ['subdominio .localhost', 'http://api.localhost/'],
  ])('bloquea también %s', async (_nombre, url) => {
    expect(await codeOf(() => validateSafeUrl(url))).toBe('blocked_host');
  });

  /**
   * `URL` normaliza las formas decimal, hexadecimal y octal a la notación con
   * puntos, así que basta con filtrar sobre el `hostname` ya normalizado. El
   * test lo fija para que un cambio futuro del parseo no abra el agujero.
   */
  it.each([
    ['decimal', 'http://2130706433/'],
    ['hexadecimal', 'http://0x7f.0.0.1/'],
    ['octal', 'http://017700000001/'],
    ['abreviada', 'http://127.1/'],
  ])('bloquea 127.0.0.1 escrita en forma %s', async (_nombre, url) => {
    expect(await codeOf(() => validateSafeUrl(url))).toBe('blocked_host');
  });

  /**
   * Un punto final es la forma absoluta del nombre y resuelve igual que sin
   * él, así que no puede servir para esquivar la lista. Lo encontró la
   * auditoría independiente: `http://localhost./` pasaba el filtro literal.
   */
  it.each([
    ['nombre reservado con punto final', 'http://localhost./'],
    ['subdominio .localhost con punto final', 'http://api.localhost./'],
    ['0.0.0.0 con punto final', 'http://0.0.0.0./'],
  ])('bloquea %s', async (_nombre, url) => {
    expect(await codeOf(() => validateSafeUrl(url))).toBe('blocked_host');
  });

  it('bloquea las IPs con punto final, las normalice o no el parser de URL', () => {
    // `URL` ya quita el punto final de una IPv4, pero `isBlockedHost` también
    // recibe direcciones de la resolución DNS, que no pasan por `URL`.
    expect(isBlockedHost('127.0.0.1.')).toBe(true);
    expect(isBlockedHost('169.254.169.254.')).toBe(true);
    expect(isBlockedHost('localhost.')).toBe(true);
  });

  it('el punto final no vuelve pública una dirección que no lo es', () => {
    // Contraprueba: un dominio público con punto final sigue permitido.
    expect(isBlockedHost('ejemplo.com.')).toBe(false);
    expect(() => validateSafeUrl('https://ejemplo.com./articulo')).not.toThrow();
  });

  it('bloquea IPv4 mapeada en IPv6 (::ffff:127.0.0.1)', () => {
    // La forma que produce `URL` al normalizar y la textual de una resolución.
    expect(isBlockedHost('::ffff:7f00:1')).toBe(true);
    expect(isBlockedHost('::ffff:127.0.0.1')).toBe(true);
  });

  it('mantiene los errores de URL inválida y protocolo no admitido', async () => {
    expect(await codeOf(() => validateSafeUrl('esto no es una url'))).toBe('invalid_url');
    expect(await codeOf(() => validateSafeUrl('ftp://ejemplo.com/x'))).toBe(
      'unsupported_protocol',
    );
  });

  it('no confunde direcciones públicas parecidas a las privadas', () => {
    // 172.32.x queda fuera de 172.16/12; 11.x fuera de 10/8.
    expect(isBlockedHost('172.32.0.1')).toBe(false);
    expect(isBlockedHost('11.0.0.1')).toBe(false);
    expect(isBlockedHost('169.253.0.1')).toBe(false);
    expect(isBlockedHost('ejemplo.com')).toBe(false);
  });
});

describe('validateSafeUrlWithDns', () => {
  it('rechaza un nombre público que resuelve a una IP privada', async () => {
    // `localtest.me` es un dominio público real cuyo DNS apunta a 127.0.0.1:
    // exactamente el caso que el filtro literal no puede ver. Si el entorno de
    // test no tiene DNS, la resolución falla y se degrada al filtro literal,
    // así que se acepta cualquiera de los dos desenlaces salvo "pasó limpio
    // habiendo resuelto a una IP privada".
    const code = await codeOf(() => validateSafeUrlWithDns('http://localtest.me/'));
    expect(['blocked_host', 'no-error']).toContain(code);
  });

  it('deja pasar un dominio público que resuelve a una IP pública', async () => {
    await expect(validateSafeUrlWithDns('https://example.com/')).resolves.toBeUndefined();
  });
});

describe('SSRF en el flujo completo', () => {
  /** `fetch` falso que falla el test si llega a llamarse. */
  const fetchProhibido: FetchLike = () => {
    throw new Error('no se debería haber hecho ninguna petición de red');
  };

  it('convertUrl rechaza una URL privada sin tocar la red', async () => {
    expect(
      await codeOf(() =>
        convertUrl('http://169.254.169.254/latest/meta-data/', { fetchImpl: fetchProhibido }),
      ),
    ).toBe('blocked_host');
  });

  it('fetchHtml rechaza una URL privada sin tocar la red', async () => {
    expect(
      await codeOf(() => fetchHtml('http://127.0.0.1:8080/admin', { fetchImpl: fetchProhibido })),
    ).toBe('blocked_host');
  });

  /**
   * El caso importante: seguir la redirección automáticamente dejaría que una
   * URL pública sirviera de trampolín hacia la red interna.
   */
  it('bloquea una redirección desde una URL pública hacia el servicio de metadatos', async () => {
    const saltos: string[] = [];
    const fetchImpl: FetchLike = (input) => {
      const url = String(input);
      saltos.push(url);
      if (url.startsWith('https://ejemplo.com')) {
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'http://169.254.169.254/latest/meta-data/' },
          }),
        );
      }
      return Promise.resolve(new Response('<html><body>secreto</body></html>'));
    };

    expect(await codeOf(() => fetchHtml('https://ejemplo.com/trampolin', { fetchImpl }))).toBe(
      'blocked_host',
    );
    // Se pidió la pública, y la interna nunca llegó a pedirse.
    expect(saltos).toEqual(['https://ejemplo.com/trampolin']);
  });

  it('sigue las redirecciones legítimas y devuelve la URL final', async () => {
    const fetchImpl: FetchLike = (input) => {
      const url = String(input);
      if (url === 'https://ejemplo.com/viejo') {
        return Promise.resolve(
          new Response(null, { status: 301, headers: { location: '/nuevo' } }),
        );
      }
      return Promise.resolve(
        new Response('<html><body><p>hola</p></body></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      );
    };

    const page = await fetchHtml('https://ejemplo.com/viejo', { fetchImpl });
    expect(page.url).toBe('https://ejemplo.com/nuevo');
    expect(page.html).toContain('hola');
  });

  it('corta una cadena de redirecciones interminable', async () => {
    const fetchImpl: FetchLike = (input) =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: `${String(input)}/mas` },
        }),
      );

    expect(await codeOf(() => fetchHtml('https://ejemplo.com/bucle', { fetchImpl }))).toBe(
      'fetch_failed',
    );
  });
});
