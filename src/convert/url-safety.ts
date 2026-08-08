/**
 * Defensa contra SSRF: rechaza URLs que apuntan a la red interna.
 *
 * Este módulo convierte URLs que da el usuario, así que sin filtro se convierte
 * en un proxy: quien llama puede pedir `http://169.254.169.254/...` y recibir
 * de vuelta lo que responda el servicio de metadatos de la nube, o sondear
 * `http://10.0.0.x` para mapear la red privada de quien despliega el código.
 * Es el vector clásico de SSRF, y aquí es especialmente relevante porque el
 * paquete se publica como librería para que otros lo integren en sus backends.
 *
 * Dos niveles de comprobación:
 *
 *   1. `validateSafeUrl` — síncrona, sobre el literal de la URL. Cubre el caso
 *      de que el host ya sea una IP (`http://127.0.0.1`) o un nombre reservado
 *      (`localhost`). Funciona en cualquier runtime.
 *   2. `validateSafeUrlWithDns` — además resuelve el nombre a IP y comprueba
 *      cada dirección devuelta, que es lo único que detiene un dominio público
 *      que apunta a `127.0.0.1` (p. ej. `localtest.me`).
 *
 * LIMITACIÓN CONOCIDA — Cloudflare Workers no ofrece resolución DNS: no expone
 * `dns.lookup` ni equivalente, ni siquiera con `nodejs_compat`. En ese runtime
 * `validateSafeUrlWithDns` degrada silenciosamente al filtro literal del nivel
 * 1. Es una degradación aceptable ahí y no en Node porque el riesgo no es el
 * mismo: en Node el proceso corre dentro de la red de quien despliega (puede
 * alcanzar su base de datos, su Redis, su servicio de metadatos), mientras que
 * un aislado de Workers no está dentro de ninguna red privada del cliente.
 *
 * LIMITACIÓN CONOCIDA — reenlace de DNS (DNS rebinding): entre que resolvemos
 * el nombre y que `fetch` lo resuelve por su cuenta, la respuesta DNS puede
 * cambiar a una IP privada. Cerrarlo del todo exige fijar la IP resuelta y
 * conectarse a ella con la cabecera `Host` original, algo que ni `fetch` de
 * Node ni el de Workers permiten hacer. Queda anotado en `DEUDA_TECNICA.md`.
 */

import { ConvertError } from './errors.js';

/**
 * Nombres de host reservados que nunca deben resolverse hacia fuera.
 *
 * `0.0.0.0` aparece aquí además de en los rangos porque muchas pilas de red lo
 * tratan como "esta máquina" al conectarse, no como una dirección de destino.
 */
const BLOCKED_HOSTNAMES: readonly string[] = [
  'localhost',
  '0.0.0.0',
  // Sufijo reservado por la RFC 6761 para uso local; nunca sale a Internet.
  'localhost.localdomain',
];

/** Rangos IPv4 bloqueados, como pares `[dirección de red, bits de máscara]`. */
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ['127.0.0.0', 8], // bucle local (RFC 1122)
  ['10.0.0.0', 8], // privada (RFC 1918)
  ['172.16.0.0', 12], // privada (RFC 1918)
  ['192.168.0.0', 16], // privada (RFC 1918)
  ['169.254.0.0', 16], // enlace local — incluye 169.254.169.254 (metadatos de nube)
  ['0.0.0.0', 8], // "esta red" (RFC 1122); no enrutable
];

/**
 * Rangos IPv6 bloqueados, como pares `[prefijo, bits de máscara]`.
 *
 * `fe80::/10` no estaba en el encargo original pero es el equivalente exacto de
 * `169.254.0.0/16` en IPv6: dejarlo pasar sería bloquear el enlace local sólo
 * en una de las dos familias de direcciones.
 */
const BLOCKED_IPV6_RANGES: readonly (readonly [string, number])[] = [
  ['::1', 128], // bucle local
  ['::', 128], // sin especificar (equivalente a 0.0.0.0)
  ['fc00::', 7], // unicast local único (RFC 4193)
  ['fe80::', 10], // enlace local (RFC 4291)
];

/** Convierte una IPv4 en notación decimal con puntos a su entero de 32 bits. */
function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  let value = 0;
  for (const part of parts) {
    // Se exige decimal sin ceros a la izquierda: `URL` ya normaliza las formas
    // octal y hexadecimal, así que cualquier cosa rara aquí no es una IPv4.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Indica si una IPv4 cae dentro de alguno de los rangos bloqueados. */
function isBlockedIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (value === null) return false;

  return BLOCKED_IPV4_RANGES.some(([network, bits]) => {
    const networkValue = parseIpv4(network);
    if (networkValue === null) return false;
    // Con `bits === 0` el desplazamiento en JS no haría lo esperado, pero no
    // usamos ningún rango /0, así que la máscara siempre es bien definida.
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return ((value ^ networkValue) & mask) >>> 0 === 0;
  });
}

/**
 * Convierte una IPv6 en sus 16 bytes.
 *
 * Admite la compresión `::` y la forma con IPv4 embebida al final
 * (`::ffff:127.0.0.1`), que es como devuelven algunas resoluciones DNS.
 */
function parseIpv6(address: string): Uint8Array | null {
  let text = address;

  // IPv4 embebida en los últimos 32 bits: se traduce a dos grupos hexadecimales
  // para poder tratar el resto de la dirección de forma uniforme.
  const embeddedIpv4 = /^(.*:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (embeddedIpv4 !== null) {
    const value = parseIpv4(embeddedIpv4[2] as string);
    if (value === null) return null;
    const high = (value >>> 16) & 0xffff;
    const low = value & 0xffff;
    text = `${embeddedIpv4[1] as string}${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const groups: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/i.test(chunk)) return null;
      groups.push(Number.parseInt(chunk, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0] as string);
  const tail = halves.length === 2 ? toGroups(halves[1] as string) : [];
  if (head === null || tail === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = (group >> 8) & 0xff;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/** Compara los `bits` iniciales de dos direcciones IPv6 ya en bytes. */
function sharesPrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const wholeBytes = Math.floor(bits / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  const remainingBits = bits % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((a[wholeBytes] ?? 0) & mask) === ((b[wholeBytes] ?? 0) & mask);
}

/** Indica si una IPv6 cae dentro de alguno de los rangos bloqueados. */
function isBlockedIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (bytes === null) return false;

  // Direcciones IPv4 mapeadas (`::ffff:a.b.c.d`): el filtro que manda es el de
  // IPv4, o `::ffff:127.0.0.1` se colaría por no estar en ningún rango IPv6.
  const isIpv4Mapped =
    bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIpv4Mapped) {
    const ipv4 = `${bytes[12] as number}.${bytes[13] as number}.${bytes[14] as number}.${bytes[15] as number}`;
    return isBlockedIpv4(ipv4);
  }

  return BLOCKED_IPV6_RANGES.some(([prefix, bits]) => {
    const prefixBytes = parseIpv6(prefix);
    return prefixBytes !== null && sharesPrefix(bytes, prefixBytes, bits);
  });
}

/**
 * Indica si un host —nombre o dirección— apunta a la red interna.
 *
 * Se exporta para poder comprobar también las IPs que devuelve la resolución
 * DNS, que no pasan por `URL` y por tanto no llegan aquí como parte de una URL.
 */
export function isBlockedHost(host: string): boolean {
  // `URL` deja las IPv6 entre corchetes; la resolución DNS, no.
  const withoutBrackets = host.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  // Se quita el punto final antes de comparar nada.
  //
  // Un punto al final es la forma absoluta del nombre —la raíz del DNS— y
  // resuelve exactamente igual que sin él: `localhost.` devuelve 127.0.0.1 y
  // ::1, comprobado. Sin quitarlo, `http://localhost./` esquivaba la lista de
  // nombres entera, porque `localhost.` no está en ella, no termina en
  // `.localhost` y tampoco parsea como IP. El mismo truco valdría contra
  // cualquier nombre que se añada a la lista más adelante.
  const normalized = withoutBrackets.replace(/\.$/, '');

  if (normalized.length === 0) return true;
  if (BLOCKED_HOSTNAMES.includes(normalized)) return true;
  // Cualquier subdominio de `.localhost` está reservado por la RFC 6761.
  if (normalized.endsWith('.localhost')) return true;
  return isBlockedIpv4(normalized) || isBlockedIpv6(normalized);
}

/** Error uniforme para todo host rechazado, con el mismo mensaje. */
function blockedHostError(host: string): ConvertError {
  return new ConvertError(
    'blocked_host',
    `La URL apunta a una dirección de red privada o local ("${host}"), que no se puede convertir.`,
  );
}

/**
 * Rechaza una URL que apunte a la red interna, mirando sólo su literal.
 *
 * Es la comprobación mínima, disponible en cualquier runtime. No detecta un
 * dominio público que resuelva a una IP privada: para eso hace falta
 * {@link validateSafeUrlWithDns}.
 *
 * @throws {ConvertError} `invalid_url` si no es una URL, `unsupported_protocol`
 *         si no es http(s), `blocked_host` si apunta a la red interna.
 */
export function validateSafeUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConvertError('invalid_url', `La URL no es válida: "${url}".`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConvertError('unsupported_protocol', 'Solo se admiten URLs http:// y https://.');
  }

  if (isBlockedHost(parsed.hostname)) {
    throw blockedHostError(parsed.hostname);
  }
}

/** Indica si el runtime es Node y no un aislado de Cloudflare Workers. */
function isNodeRuntime(): boolean {
  const cloudflare = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
  if (cloudflare === 'Cloudflare-Workers') return false;
  const versions = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions;
  return typeof versions?.node === 'string';
}

/**
 * Resuelve un nombre a sus direcciones IP.
 *
 * Devuelve una lista vacía cuando el runtime no permite resolver (Workers) o
 * cuando la resolución falla: en ambos casos la decisión se deja al filtro
 * literal, que ya se ha aplicado antes.
 */
async function resolveHost(hostname: string): Promise<readonly string[]> {
  if (!isNodeRuntime()) return [];
  try {
    const dns = await import('node:dns');
    const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    return records.map((record) => record.address);
  } catch {
    return [];
  }
}

/**
 * Rechaza una URL que apunte a la red interna, resolviendo además el nombre.
 *
 * Aplica primero el filtro literal y luego, si el runtime lo permite, comprueba
 * cada IP a la que resuelve el nombre. Es la comprobación que hay que usar
 * justo antes de un `fetch`.
 *
 * @throws {ConvertError} igual que {@link validateSafeUrl}.
 */
export async function validateSafeUrlWithDns(url: string): Promise<void> {
  validateSafeUrl(url);

  const hostname = new URL(url).hostname.replace(/^\[/, '').replace(/\]$/, '');
  for (const address of await resolveHost(hostname)) {
    if (isBlockedHost(address)) {
      // Se nombra el host pedido, no la IP resuelta: devolver la IP interna
      // convertiría el propio mensaje de error en un oráculo de red.
      throw blockedHostError(hostname);
    }
  }
}
