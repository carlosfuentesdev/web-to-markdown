<div align="center">

# 📄 web-to-markdown

**Convierte cualquier página web o HTML crudo en Markdown limpio, denso y listo
para LLMs.** Elimina la navegación, los banners de cookies, los anuncios y los
pies de página; conserva los encabezados, las listas, los bloques de código, los
enlaces y las tablas. Corre en el edge (Cloudflare Workers) y en tu terminal.

[![npm](https://img.shields.io/npm/v/@karlangas12/web-to-markdown?color=cb3837&logo=npm)](https://www.npmjs.com/package/@karlangas12/web-to-markdown)
[![tests](https://img.shields.io/badge/tests-43%20passing-brightgreen)](#pruebas)
[![latency](https://img.shields.io/badge/html%E2%86%92md-~3ms-blue)](#rendimiento)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)

[Inicio rápido](#inicio-rápido) · [CLI](#cli) · [API HTTP](#api-http) · [SDK](#sdk) · [Despliegue](#despliega-tu-propia-api-edge) · [Límites](#límites-honestos) · [English](README.md)

</div>

> **Nota:** la cara pública del paquete (este README en inglés, `README.md`) va
> en inglés a propósito: npm, GitHub y las comunidades donde se difunde son
> anglófonas. Este `README.es.md` es el espejo en español que exige la guía de
> la fábrica. Todo lo interno —código, PRD, mensajes de error, logs— es español.

---

## Por qué

Dar una página web cruda a un LLM es caro y con pérdidas. Una página de artículo
típica es 90% decorado —menús, avisos de cookies, "artículos relacionados",
scripts de rastreo— y el propio marcado HTML gasta tokens que no aportan
significado. Pagas por todo ello y el modelo lee esquivándolo.

`web-to-markdown` hace una sola cosa: extrae el contenido real y emite el
Markdown fiel más denso posible, para que en una ventana de contexto quepa más
señal por token. Sin navegador headless, sin parsers pesados: una pasada AST
ligera que corre en **milisegundos de un solo dígito** y se despliega en el edge
con coste cero en reposo.

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

## API HTTP

### Visión general

**Web to Markdown API** convierte cualquier URL pública (o un HTML crudo) en
Markdown limpio y listo para LLMs, a través de un endpoint HTTP autenticado
sencillo. Corre en Cloudflare Workers, así que cada petición se sirve en el
edge sin infraestructura fría que gestionar.

**Base URL (producción):**

```
https://web-to-markdown.karlangas12.workers.dev
```

### Autenticación y cuotas

Toda petición bajo `/v1/*` exige una API key, enviada como:

```
x-api-key: tu_api_key
```

(`Authorization: Bearer tu_api_key` también se acepta, si encaja mejor con tu
cliente.) `GET /salud` es pública y no necesita clave.

| Plan | Cuota | Ventana |
| --- | --- | --- |
| Gratis | 500 conversiones | por mes natural |
| Pro | 2000 conversiones | por mes natural |

Toda respuesta autenticada lleva las cabeceras estándar de rate limit:

| Cabecera | Significado |
| --- | --- |
| `RateLimit-Limit` | La cuota de tu plan en esta ventana |
| `RateLimit-Remaining` | Peticiones que quedan antes de que la ventana se reinicie |
| `RateLimit-Reset` | Marca de tiempo Unix (segundos) en que la ventana se reinicia |

Una vez agotada la cuota, la API responde `429 Too Many Requests` con una
cabecera `Retry-After` (segundos hasta la siguiente ventana).

### Endpoints

#### `GET /salud`

Sonda de vida pública. No requiere API key.

```bash
curl https://web-to-markdown.karlangas12.workers.dev/salud
```

`200 OK`:

```json
{
  "ok": true,
  "data": { "estado": "ok", "entorno": "production" }
}
```

#### `POST /v1/convert`

Convierte una página a Markdown. El cuerpo es JSON con exactamente uno de
`url` o `html`:

```json
{ "url": "https://example.com" }
```

`options` opcional: `{ "include_images": false, "extract_metadata": true }`
(ambos son `false` por defecto).

**`200 OK`** — conversión correcta:

```json
{
  "ok": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is for use in documentation examples…",
    "metadata": null
  }
}
```

Añade `Accept: text/markdown` (o `?format=markdown` en la variante `GET` de
abajo) para recibir el Markdown crudo en vez del sobre JSON.

**`401 Unauthorized`** — falta la cabecera `x-api-key` o la clave no es
válida:

```json
{
  "ok": false,
  "error": { "code": "unauthorized", "message": "La API key no es válida." }
}
```

**`429 Too Many Requests`** — has agotado la cuota mensual de tu plan:

```json
{
  "ok": false,
  "error": { "code": "rate_limited", "message": "Has superado el límite de 500 peticiones. Reintenta en 1234 s." }
}
```

También existe la variante `GET /v1/convert?url=` de un solo paso, cómoda para
agentes y curl; pasa `?metadata=true` / `?images=true` para activar esas
opciones.

### Ejemplos de código

**cURL**

```bash
curl -X POST https://web-to-markdown.karlangas12.workers.dev/v1/convert \
  -H "x-api-key: tu_api_key" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com" }'
```

**JavaScript / TypeScript** (`fetch` nativo — Node.js 18+ o navegador)

```ts
const response = await fetch('https://web-to-markdown.karlangas12.workers.dev/v1/convert', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.WEB_TO_MARKDOWN_API_KEY!,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ url: 'https://example.com' }),
});

const { data } = await response.json();
console.log(data.markdown);
```

**Python** (`requests`)

```python
import os
import requests

response = requests.post(
    "https://web-to-markdown.karlangas12.workers.dev/v1/convert",
    headers={"x-api-key": os.environ["WEB_TO_MARKDOWN_API_KEY"]},
    json={"url": "https://example.com"},
)
response.raise_for_status()
print(response.json()["data"]["markdown"])
```

### Obtención de la API key

Las API keys se emiten a través de [Polar.sh](https://polar.sh), el proveedor
de cobro detrás de los planes Gratis y Pro:

1. Suscríbete al plan Gratis o Pro a través del checkout de Polar para este
   producto.
2. Polar nos notifica tu suscripción; emitimos tu `x-api-key` y la enviamos al
   correo asociado a tu cuenta de Polar.
3. Subir o cancelar tu suscripción de Polar sube o baja automáticamente la
   cuota de tu clave existente: no hace falta pedir una clave nueva.

> Hoy la emisión de claves es un paso manual por nuestra parte, no una entrega
> de autoservicio instantánea: espera tu clave poco después de suscribirte, no
> de inmediato en el propio checkout.

La autenticación, el rate limiting por plan y el webhook de cobro vienen del
núcleo de la fábrica; ver
[Despliega tu propia API edge](#despliega-tu-propia-api-edge) si vas a correr
tu propia instancia en vez de usar la alojada de arriba.

## SDK

Todo lo que usan la CLI y el Worker está exportado y con pocas dependencias (un
parser de HTML, un validador). Es síncrono para HTML y asíncrono solo cuando
tiene que descargar.

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
llevan `>`, y las tablas pasan a Markdown estilo GitHub con las barras
escapadas.

**Exprime los tokens.** Colapsa el espacio en blanco redundante, quita los
espacios al final de línea y funde las líneas en blanco seguidas a un único
salto de párrafo. El resultado es Markdown que un modelo lee limpio, sin gastar
nada en maquetación.

**Lee los metadatos.** Opcionalmente devuelve título (Open Graph → `<title>` →
primer `<h1>`), descripción, URL canónica, fecha de publicación detectada
(normalizada a ISO 8601), número de palabras, una estimación rápida de tokens y
el tiempo de lectura.

### Páginas hidratadas por framework

**Rescata el contenido que una SPA dejó atrás — sin ejecutar JavaScript.**
Cuando el DOM visible llega prácticamente vacío (el clásico
`<div id="root"></div>`), busca los datos que el framework ya serializó en el
HTML para su propia hidratación y lee eso. Cuatro fuentes, por orden de
fiabilidad:

| Fuente | Qué es |
| --- | --- |
| `application/ld+json` | JSON-LD de schema.org. Un estándar de verdad, etiquetado explícitamente e independiente del framework — con diferencia el más fiable, así que gana cuando conviven varios. |
| `__NEXT_DATA__` | Next.js con Pages Router. Un único JSON bien formado. |
| `self.__next_f.push(...)` | Next.js con App Router (RSC). Un flujo troceado y escapado; la prosa se rescata como se puede, porque el formato no es público ni estable. |
| `window.__NUXT__` | Nuxt, y sólo cuando ese valor resulta ser JSON. A veces es una función autoejecutada, y entonces se abandona en vez de evaluarla. |

Conviene ser claro sobre qué es y qué no. Esto es **parsear texto que ya venía
en la respuesta**: sin motor de JS, sin navegador, sin evaluar nada. No es
renderizar, ni es una respuesta general a "maneja sitios con JavaScript". Si
una página pide su contenido después de cargar, o lo esconde tras un framework
que esto no reconoce, obtienes el mismo resultado vacío que antes. El rescate
sólo entra cuando la extracción normal baja de 200 caracteres, y sólo sustituye
si de verdad recupera más texto: una página corta pero legítima nunca se cambia
por fragmentos sueltos de un JSON.

**Se niega a tocar tu red interna.** Las URLs que apuntan a direcciones de bucle
local, privadas o de enlace local — `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`,
`192.168.0.0/16`, `169.254.0.0/16` (que incluye `169.254.169.254`, el servicio
de metadatos de la nube), `localhost`, `::1`, `fc00::/7`, `fe80::/10` — se
rechazan antes de hacer ninguna petición. Es deliberado y no configurable: esta
librería está pensada para recibir URLs que vienen de tus usuarios, y sin ese
filtro sería un proxy de SSRF hacia la red en la que la ejecutes. Cada
redirección se vuelve a comprobar, así que una URL pública no puede servir de
trampolín hacia algo privado. En Node.js además se resuelve el nombre y se
comprueba cada IP resultante, lo que atrapa dominios públicos que apuntan a
`127.0.0.1`; en Cloudflare Workers, donde no hay resolución DNS disponible,
sólo se aplica la comprobación literal.

## Despliega tu propia API edge

El Worker no se publica en npm: despliegas el tuyo con
[Wrangler](https://developers.cloudflare.com/workers/). Trae el circuito
monetizable completo del núcleo de la fábrica: **configuración validada →
logging estructurado → API key → cuota por plan → conversión**, más un endpoint
de webhook del Merchant of Record para el cobro.

```bash
wrangler kv namespace create CLAVES        # API keys (hash → registro)
wrangler kv namespace create CONTADORES    # contadores de rate limit
wrangler kv namespace create EVENTOS       # idempotencia de webhooks
# pega cada id devuelto en wrangler.toml

wrangler secret put POLAR_WEBHOOK_SECRET   # secreto de firma del webhook de cobro

wrangler dev        # http://localhost:8787
wrangler deploy
```

`GET /salud` es una sonda de vida sin autenticación. `/v1/*` exige API key
(`Authorization: Bearer …` o `X-API-Key`) y aplica la cuota del plan del cliente,
devolviendo cabeceras `RateLimit-*`. `POST /webhooks/polar` recibe los eventos
de suscripción de Polar y activa o revierte el plan del cliente en consecuencia.

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
analítica, nada llama a casa. Lo que despliegues en tu propio Worker es tuyo.

## Parte de un combo

`web-to-markdown` es el tercer activo de un pequeño kit para quien monta agentes
de IA. Se componen entre sí:

- **[openapi-to-mcp](https://www.npmjs.com/package/@karlangas12/openapi-to-mcp)** — convierte cualquier spec OpenAPI en un servidor MCP en vivo.
- **[mcp-shield-proxy](https://github.com/carlosfuentesdev/mcp-shield-proxy)** — un cortafuegos local que inspecciona lo que hacen tus herramientas MCP.
- **web-to-markdown** — alimenta a esas herramientas con contexto web limpio y denso.

## Límites honestos

Conviene leerlos antes de depender de esto.

- **Es un extractor heurístico, no un renderizador.** Lee el HTML que le das y
  **nunca ejecuta JavaScript**: no hay motor de JS ni navegador en ninguna parte
  del paquete. Cuando una página renderizada en cliente envía un
  `<div id="root">` vacío, recurre a leer los datos que el propio framework ya
  dejó serializados en la respuesta (ver [Páginas hidratadas por
  framework](#páginas-hidratadas-por-framework)), lo que cubre buena parte de
  los sitios de Next.js y Nuxt, pero no todos. Una página cuyo contenido sólo
  existe después de que corra su propio código —pedido por `fetch` al montar,
  por ejemplo— sigue sin tener nada que extraer, y no hay parseo que lo
  arregle. Para eso hace falta un navegador headless por delante, que esto a
  propósito no es.
- **La selección de contenido es por reglas.** El emparejamiento por token de
  class/id más la elección de `<main>`/`<article>` por densidad cubre bien los
  casos comunes; una maquetación rara aún puede colar una barra lateral suelta o
  recortar una sección. No es un modelo de readability entrenado.
- **El conteo de tokens es una estimación.** Una heurística de ~4 caracteres por
  token, suficiente para dimensionar un contexto, no un tokenizador BPE real; no
  factures por él.
- **La emisión de claves es manual, no de autoservicio.** Las suscripciones de
  Polar suben o revierten el plan de una clave que ya emitiste; un suscriptor
  nuevo no recibe una clave de forma automática — ver
  [Obtención de la API key](#obtención-de-la-api-key).
- **Las tablas y el código asumen HTML válido.** Un marcado muy malformado, o un
  `<` sin escapar dentro de un `<pre>`, todavía puede confundir a cualquier
  parser de HTML.

## Pruebas

```bash
npm test          # 43 tests: limpieza, markdown, metadatos, fetch, worker
npm run typecheck # TypeScript estricto, sin emitir
npm run build     # compila el SDK + CLI publicable a dist/
```

## Licencia

MIT — ver [LICENSE](LICENSE).
