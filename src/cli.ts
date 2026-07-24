#!/usr/bin/env node
/**
 * Interfaz de línea de comandos de web-to-markdown.
 *
 * Convierte una URL, un fichero HTML local o el HTML recibido por la entrada
 * estándar en Markdown, y lo escribe en stdout o en un fichero. La ayuda y los
 * errores van en español (regla de la fábrica); el README, en inglés.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { convertHtml, convertUrl } from './convert/convert.js';
import { isConvertError } from './convert/errors.js';
import type { ConvertResult } from './convert/types.js';

const VERSION = '0.1.0';

interface CliOptions {
  input?: string;
  output?: string;
  images: boolean;
  json: boolean;
  timeoutMs?: number;
  userAgent?: string;
}

async function runCli(argv: readonly string[]): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`web-to-markdown v${VERSION}\n`);
    return;
  }

  const options = parseArgs(argv);
  const result = await convert(options);

  const payload = options.json ? `${JSON.stringify(result, null, 2)}\n` : result.markdown;

  if (options.output === undefined) {
    process.stdout.write(payload);
    return;
  }
  await writeFile(options.output, payload, 'utf8');
  process.stderr.write(`✓ Escrito en ${options.output}\n`);
}

/** Resuelve la fuente de entrada (URL, fichero o stdin) y convierte. */
async function convert(options: CliOptions): Promise<ConvertResult> {
  const source = options.input;

  if (source !== undefined && isHttpUrl(source)) {
    return convertUrl(source, {
      includeImages: options.images,
      extractMetadata: options.json,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.userAgent === undefined ? {} : { userAgent: options.userAgent }),
    });
  }

  const html =
    source === undefined || source === '-' ? await readStdin() : await readFile(source, 'utf8');

  if (html.trim().length === 0) {
    throw new CliError(
      'No hay HTML que convertir. Pasa una URL, un fichero, o envía HTML por la entrada estándar.',
    );
  }

  return convertHtml(html, { includeImages: options.images, extractMetadata: options.json });
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { images: false, json: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--output':
      case '-o':
        options.output = requireValue(argv, (i += 1), arg);
        break;
      case '--images':
        options.images = true;
        break;
      case '--json':
      case '--metadata':
        options.json = true;
        break;
      case '--timeout':
        options.timeoutMs = parsePositiveInt(requireValue(argv, (i += 1), arg));
        break;
      case '--user-agent':
        options.userAgent = requireValue(argv, (i += 1), arg);
        break;
      default:
        if (arg !== undefined && (arg === '-' || !arg.startsWith('-')) && options.input === undefined) {
          options.input = arg;
        }
        break;
    }
  }

  return options;
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new CliError(`La opción ${flag} necesita un valor.`);
  return value;
}

function parsePositiveInt(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`Se esperaba un entero positivo, no "${raw}".`);
  }
  return value;
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/** Lee todo el HTML de la entrada estándar. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Error de uso de la CLI; su mensaje sí se muestra al usuario. */
class CliError extends Error {}

function printHelp(): void {
  process.stdout.write(`web-to-markdown v${VERSION} — convierte cualquier web o HTML en Markdown para LLMs

USO
  web-to-markdown <url>                 Descarga y convierte una URL
  web-to-markdown pagina.html           Convierte un fichero HTML local
  cat pagina.html | web-to-markdown -   Convierte el HTML de la entrada estándar

OPCIONES
  -o, --output <fichero>   Escribe el resultado en un fichero (por defecto: stdout)
      --images             Incluye las imágenes como ![alt](src) (por defecto se omiten)
      --json               Salida JSON { markdown, metadata } en vez de Markdown crudo
      --metadata           Alias de --json
      --timeout <ms>       Timeout de descarga en milisegundos (por defecto: 5000)
      --user-agent <ua>    User-Agent a enviar en la descarga
  -h, --help               Esta ayuda
  -v, --version            Versión

EJEMPLOS
  web-to-markdown https://example.com/articulo --output articulo.md
  web-to-markdown https://example.com --json > pagina.json
`);
}

void runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof CliError || isConvertError(error)
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`✗ ${message}\n`);
  process.exitCode = 1;
});
