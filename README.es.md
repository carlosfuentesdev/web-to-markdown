<div align="center">

# 📄 web-to-markdown

**Convierte cualquier página web o HTML crudo en Markdown limpio, denso y listo
para LLMs.** Elimina la navegación, los banners de cookies, los anuncios y los
pies de página; conserva los encabezados, las listas, los bloques de código, los
enlaces y las tablas. Corre en Cloudflare Workers, Node, Deno y Bun — y en tu
terminal.

[![npm](https://img.shields.io/npm/v/@karlangas12/web-to-markdown?color=cb3837&logo=npm)](https://www.npmjs.com/package/@karlangas12/web-to-markdown)
[![tests](https://img.shields.io/badge/tests-38%20passing-brightgreen)](#pruebas)
[![latency](https://img.shields.io/badge/html%E2%86%92md-~3ms-blue)](#rendimiento)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)

[Inicio rápido](#inicio-rápido) · [CLI](#cli) · [SDK](#sdk) · [Edge](#ejecútalo-en-el-edge) · [Límites](#límites-honestos) · [English](README.md)

</div>

> **Nota:** la cara pública del paquete (`README.md`) va en inglés a propósito:
> npm, GitHub y las comunidades donde se difunde son anglófonas. Este
> `README.es.md` es el espejo en español.

---

## Por qué

Dar una página web cruda a un LLM es caro y con pérdidas. Una página de artículo
típica es 90% decorado —menús, avisos de cookies, "artículos relacionados",
scripts de rastreo— y el propio marcado HTML gasta tokens que no aportan
significado. Pagas por todo ello y el modelo lee esquivándolo.

`web-to-markdown` hace una sola cosa: extrae el contenido real y emite el
Markdown fiel más denso posible, para que en una ventana de contexto quepa más
señal por token. Sin navegador headless, sin parsers pesados: una pasada AST
ligera que corre en **milisegundos de un solo dígito** y, como usa solo APIs web
estándar, corre en cualquier sitio: el edge, una función serverless o un script.

Está pensado para lo que consume contexto: Cursor, Claude Code, pipelines de RAG
y agentes autónomos que necesitan leer una página a mitad de una tarea.

## Inicio rápido

Convierte una URL desde la terminal, sin instalar nada:

```bash
npx @karlangas12/web-to-markdown https://example.com/articulo
```

O úsalo como librería:

```bash
npm install @karlangas12/web-to-markdown
```

```ts
import { convertUrl } from '@karlangas12/web-to-markdown';

const { markdown } = await convertUrl('https://example.com/articulo');
console.log(markdown);
```

## CLI

```bash
web-to-markdown <url>                 # descarga y convierte una URL
web-to-markdown pagina.html           # convierte un fichero HTML local
cat pagina.html | web-to-markdown -   # convierte el HTML de la entrada estándar
```

| Opción | Efecto |
| --- | --- |
| `-o, --output <fichero>` | Escribe en un fichero en vez de stdout |
| `--images` | Conserva las imágenes como `![alt](src)` (por defecto se omiten) |
| `--json` / `--metadata` | Emite JSON `{ markdown, metadata }` en vez de Markdown crudo |
| `--timeout <ms>` | Timeout de descarga (por defecto `5000`) |
| `--user-agent <ua>` | Sobrescribe el User-Agent de la descarga |
| `-h, --help` · `-v, --version` | Ayuda / versión |

```bash
# Guarda un artículo, con imágenes, en un fichero
web-to-markdown https://example.com/post --images -o post.md

# Obtén metadatos (título, descripción, canónica, fecha, estimación de tokens)
web-to-markdown https://example.com/post --json > post.json
```

El Markdown va a **stdout**; las líneas de estado van a **stderr**, para que las
tuberías queden limpias.

## SDK

Todo lo que usa la CLI está exportado y con pocas dependencias (un parser de
HTML, un validador). Es síncrono para HTML y asíncrono solo cuando descarga.

```ts
import {
  convertHtml,      // (html, options?) => { markdown, metadata }
  convertUrl,       // (url, options?) => Promise<{ markdown, metadata }>
  fetchHtml,        // (url, options?) => Promise<{ html, url }>
  estimateTokens,   // estimación rápida de tokens de cualquier cadena
  ConvertError,     // errores tipados con un `code` estable
} from '@karlangas12/web-to-markdown';

// Desde HTML crudo (sin red): ideal para scrapers que ya ejecutas
const { markdown, metadata } = convertHtml(htmlCrudo, {
  includeImages: false,
  extractMetadata: true,
  baseUrl: 'https://example.com/articulo',   // resuelve enlaces relativos
});

// Desde una URL, con un fetch inyectable (útil en tests)
const page = await convertUrl('https://example.com', {
  timeoutMs: 4000,
  fetchImpl: miFetch,
});
```

### Opciones

| Opción | Por defecto | Significado |
| --- | --- | --- |
| `includeImages` | `false` | Emite las imágenes como `![alt](src)` |
| `extractMetadata` | `false` | Calcula el objeto `metadata` |
| `baseUrl` | — | Base para resolver enlaces/imágenes relativos (`convertUrl` la rellena) |
| `timeoutMs` | `5000` | Timeout de descarga (`convertUrl` / `fetchHtml`) |
| `maxBytes` | `5 MB` | Tope duro de la respuesta descargada |
| `userAgent` | UA identificable | Cabecera User-Agent de la descarga |

### Metadatos

Con `extractMetadata: true` obtienes además:

```json
{
  "title": "Título del artículo",
  "description": "Un resumen breve.",
  "canonicalUrl": "https://example.com/articulo",
  "publishedAt": "2026-07-01T10:00:00.000Z",
  "wordCount": 1240,
  "estimatedTokens": 1660,
  "readingTimeMinutes": 6
}
```

El título cae en cascada Open Graph → `<title>` → primer `<h1>`; la fecha se
normaliza a ISO 8601; el conteo de tokens es una estimación rápida (ver límites).

## Qué hace

**Quita el ruido.** `script`, `style`, `iframe`, `svg`, `form` y compañía se van
primero. Luego `nav`, `aside`, el `header`/`footer` de página y cualquier
contenedor cuyo `class`/`id`/`role` suene a decorado —`cookie-banner`,
`ad-container`, `newsletter`, `sidebar`, `related`…— por token completo, para que
`gradient` no se confunda con `ad` y una `entry-header` que lleva el título
sobreviva.

**Conserva el significado.** Los encabezados van a `#`–`######`, las listas
(ordenadas y no) se anidan con la sangría correcta, `<pre><code
class="language-x">` se vuelve un bloque vallado con su lenguaje, las citas
llevan `>`, y las tablas pasan a Markdown estilo GitHub con las barras escapadas.

**Exprime los tokens.** Colapsa el espacio en blanco redundante, quita los
espacios al final de línea y funde las líneas en blanco seguidas a un único salto
de párrafo. El resultado es Markdown que un modelo lee limpio, sin gastar nada en
maquetación.

## Ejecútalo en el edge

El núcleo de conversión usa solo APIs web estándar (`fetch`, `URL`,
`TextDecoder`, `AbortController`), así que corre en Cloudflare Workers, Deno y Bun
sin ningún shim. En [`examples/cloudflare-worker`](examples/cloudflare-worker)
hay un Worker mínimo y desplegable construido sobre el SDK:

```ts
import { convertUrl } from '@karlangas12/web-to-markdown';

export default {
  async fetch(request: Request): Promise<Response> {
    const target = new URL(request.url).searchParams.get('url');
    if (!target) return new Response('Falta ?url=', { status: 400 });
    const { markdown } = await convertUrl(target);
    return new Response(markdown, {
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
    });
  },
};
```

Ese ejemplo va sin autenticación a propósito: es una demo. Para un servicio de
verdad, añade una API key, un rate limit por plan y (porque descarga URLs
arbitrarias) una lista de permitidos contra SSRF delante del fetch. Ver
[SECURITY.md](.github/SECURITY.md).

## Rendimiento

La conversión es CPU pura en la ruta de la petición, así que el presupuesto es
ajustado: el objetivo es **menos de 10 ms por documento estándar**. Medido en
Node 22 / Windows 11, una página de artículo de 14,5 KB (≈2 000 tokens de
salida), 2 000 iteraciones:

| | media | p50 | p90 | **p99** |
| --- | --- | --- | --- | --- |
| HTML → Markdown (+ metadatos) | 3,1 ms | 2,9 ms | 4,4 ms | **5,4 ms** |

El coste escala aproximadamente con el tamaño del documento (~n·log n en la
práctica); una página muy grande de 58 KB ronda los 19 ms. La ruta `convertUrl`
suma la descarga de red, acotada por el timeout de 5 s y el tope de 5 MB. Nunca
se lanza un navegador headless.

## Privacidad

La librería y la CLI hacen exactamente una llamada de red —la página que pediste—
y solo en `convertUrl`. `convertHtml` no toca la red. Sin telemetría, sin
analítica, nada llama a casa.

## Parte de un combo

`web-to-markdown` es una de un pequeño kit de herramientas para quien monta
agentes de IA. Se componen entre sí:

- **[openapi-to-mcp](https://www.npmjs.com/package/@karlangas12/openapi-to-mcp)** — convierte cualquier spec OpenAPI en un servidor MCP en vivo (le da **herramientas** al agente).
- **[mcp-shield-proxy](https://github.com/Karlangas12/mcp-shield-proxy)** — un cortafuegos local que inspecciona lo que hacen tus herramientas MCP (le da **seguridad**).
- **web-to-markdown** — alimenta a esas herramientas con contexto web limpio y denso (le da **contexto**).

## Límites honestos

Conviene leerlos antes de depender de esto.

- **Es un extractor heurístico, no un renderizador.** Lee el HTML que le das; no
  ejecuta JavaScript. Una página que envía un `<div id="root">` vacío y lo pinta
  todo en el cliente no tiene nada que extraer: haría falta un navegador headless
  por delante, que esto a propósito no es.
- **La selección de contenido es por reglas.** El emparejamiento por token de
  class/id más la elección de `<main>`/`<article>` por densidad cubre bien los
  casos comunes; una maquetación rara aún puede colar una barra lateral suelta o
  recortar una sección. No es un modelo de readability entrenado.
- **El conteo de tokens es una estimación.** Una heurística de ~4 caracteres por
  token, suficiente para dimensionar un contexto, no un tokenizador BPE real; no
  factures por él.
- **Descargar URLs arbitrarias es una superficie de SSRF.** Bien para una CLI en
  tu máquina; si expones `convertUrl` como endpoint público, filtra el destino.
  Ver [SECURITY.md](.github/SECURITY.md).
- **Las tablas y el código asumen HTML válido.** Un marcado muy malformado, o un
  `<` sin escapar dentro de un `<pre>`, todavía puede confundir a cualquier
  parser de HTML.

## Pruebas

```bash
npm test          # 38 tests: limpieza, markdown, metadatos, fetch, tokens
npm run typecheck # TypeScript estricto, sin emitir
npm run build     # compila el SDK + CLI publicable a dist/
```

## Licencia

MIT — ver [LICENSE](LICENSE).
