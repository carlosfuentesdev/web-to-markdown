/**
 * Tipos públicos de la conversión.
 *
 * Los identificadores van en inglés (el paquete se consume desde TypeScript);
 * los comentarios, en español, como manda la guía de la fábrica.
 */

/** Opciones de conversión de HTML o URL a Markdown. */
export interface ConvertOptions {
  /**
   * Incluir imágenes como `![alt](src)`. Desactivado por defecto: en un contexto
   * de LLM las imágenes gastan tokens sin aportar texto.
   */
  readonly includeImages?: boolean;
  /** Calcular y devolver los metadatos (título, descripción, canónica, tokens...). */
  readonly extractMetadata?: boolean;
  /**
   * URL base para resolver enlaces e imágenes relativos. Cuando el HTML procede
   * de `convertUrl`, se rellena con la URL final tras las redirecciones.
   */
  readonly baseUrl?: string;
}

/** Metadatos derivados de la página y del Markdown resultante. */
export interface Metadata {
  /** Título de la página (`<title>`, `og:title` o el primer `<h1>`). */
  readonly title: string | null;
  /** Descripción (`meta[name=description]` u `og:description`). */
  readonly description: string | null;
  /** URL canónica (`link[rel=canonical]` u `og:url`). */
  readonly canonicalUrl: string | null;
  /** Fecha de publicación detectada, en ISO 8601, o `null` si no se encuentra. */
  readonly publishedAt: string | null;
  /** Número de palabras del Markdown resultante. */
  readonly wordCount: number;
  /** Estimación rápida de tokens del Markdown (heurística, no un tokenizador real). */
  readonly estimatedTokens: number;
  /** Tiempo estimado de lectura en minutos (~200 palabras/min). */
  readonly readingTimeMinutes: number;
}

/** Resultado de una conversión. */
export interface ConvertResult {
  /** El Markdown limpio y denso. */
  readonly markdown: string;
  /** Metadatos, o `null` si `extractMetadata` estaba desactivado. */
  readonly metadata: Metadata | null;
}
