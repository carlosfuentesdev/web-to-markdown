/**
 * Estimación de densidad de texto: palabras y tokens.
 *
 * No cargamos un tokenizador BPE real (pesado y lento en el edge). Usamos una
 * heurística de ~4 caracteres por token, la aproximación habitual para texto en
 * inglés/español con los tokenizadores de la familia GPT/Claude. Es una
 * estimación, suficiente para dimensionar un contexto, no para facturar por token.
 */

/** Cuenta las palabras de un texto (secuencias separadas por espacios). */
export function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches === null ? 0 : matches.length;
}

/** Estima el número de tokens de un texto. */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  // Mezcla longitud en caracteres con número de palabras: los tokenizadores
  // parten las palabras largas y funden las cortas, y este promedio se acerca
  // más que caracteres/4 a secas.
  const chars = trimmed.length;
  const words = countWords(trimmed);
  return Math.max(1, Math.round((chars / 4 + words) / 2));
}

/** Minutos estimados de lectura a ~200 palabras por minuto. */
export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 200));
}
