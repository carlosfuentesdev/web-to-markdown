/**
 * Compresión de tokens (token shrinkage).
 *
 * El conversor ya produce Markdown razonable; este paso da la pasada final que
 * exprime tokens sin tocar el significado: quita espacios al final de línea,
 * colapsa tres o más saltos de línea a dos (un único separador de párrafo) y deja
 * exactamente un salto de línea final. No colapsa los espacios internos de las
 * líneas: dentro de un bloque de código son significativos.
 */

/** Normaliza el Markdown para maximizar la densidad de información por token. */
export function shrink(markdown: string): string {
  const trimmedLines = markdown
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');

  const collapsed = trimmedLines
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');

  return collapsed.length > 0 ? `${collapsed}\n` : '';
}
