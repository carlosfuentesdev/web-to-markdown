/**
 * Errores del núcleo de conversión.
 *
 * El núcleo es autónomo: no depende de `motor3-core` para poder publicarse tal
 * cual en npm. Define su propio error con un `code` estable; es el Worker quien
 * lo traduce a `AppError`/estado HTTP, y la CLI quien imprime su mensaje.
 */

/** Códigos estables de fallo de conversión. */
export type ConvertErrorCode =
  | 'invalid_url'
  | 'unsupported_protocol'
  /** La URL apunta a la red interna (bucle local, privada o enlace local). */
  | 'blocked_host'
  | 'fetch_failed'
  | 'http_error'
  | 'too_large'
  | 'not_html'
  | 'empty_content';

export interface ConvertErrorOptions {
  readonly cause?: unknown;
  /** Código de estado de la respuesta remota, cuando aplica (`http_error`). */
  readonly upstreamStatus?: number;
}

/** Error de conversión con código tratable programáticamente. */
export class ConvertError extends Error {
  readonly code: ConvertErrorCode;
  readonly upstreamStatus: number | null;

  constructor(code: ConvertErrorCode, message: string, options: ConvertErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ConvertError';
    this.code = code;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

/** Comprueba si un valor es un `ConvertError`. */
export function isConvertError(value: unknown): value is ConvertError {
  return value instanceof ConvertError;
}
