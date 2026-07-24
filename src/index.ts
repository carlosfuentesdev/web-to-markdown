/**
 * Punto de entrada del SDK de web-to-markdown.
 *
 * Expone el núcleo de conversión —autónomo, sin dependencia de la fábrica— para
 * consumirlo desde cualquier proyecto TypeScript/JavaScript. El Worker (`worker.ts`)
 * y la CLI (`cli.ts`) se apoyan en este mismo núcleo.
 */

export { convertHtml, convertUrl } from './convert/convert.js';
export type { ConvertUrlOptions } from './convert/convert.js';
export type { ConvertOptions, ConvertResult, Metadata } from './convert/types.js';

export {
  fetchHtml,
  DEFAULT_USER_AGENT,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} from './convert/fetch.js';
export type { FetchHtmlOptions, FetchedPage, FetchLike } from './convert/fetch.js';

export { ConvertError, isConvertError } from './convert/errors.js';
export type { ConvertErrorCode } from './convert/errors.js';

export { estimateTokens, countWords, readingTimeMinutes } from './convert/tokens.js';
