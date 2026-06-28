/**
 * Pluggable tokenizer for token-aware prompt rendering.
 *
 * Provides a default character-based estimator (chars/4) and a global
 * configuration point for users to plug in a real tokenizer like
 * `js-tiktoken` or `gpt-tokenizer`.
 *
 * @module
 */

/**
 * A function that counts (or estimates) the number of tokens in a string.
 *
 * @example
 * ```ts
 * // Use js-tiktoken for accurate counts
 * import { getEncoding } from 'js-tiktoken'
 * const enc = getEncoding('cl100k_base')
 * setTokenizer((text) => enc.encode(text).length)
 *
 * // Or use a simple character-based estimate (the default)
 * setTokenizer((text) => Math.ceil(text.length / 4))
 * ```
 */
export type TokenizerFn = (text: string) => number

/**
 * Default token estimator: `Math.ceil(text.length / 4)`.
 *
 * This is a rough heuristic (~4 chars per token for English text).
 * For production use, configure a real tokenizer via `setTokenizer()`.
 */
export const defaultTokenizer: TokenizerFn = (text: string) => Math.ceil(text.length / 4)

let _tokenizer: TokenizerFn = defaultTokenizer

/**
 * Set the global tokenizer function used for token counting.
 *
 * Call this once at application startup to plug in a real tokenizer.
 * If not called, the default character-based estimator is used.
 *
 * @param fn - A function that counts tokens in a string.
 *
 * @example
 * ```ts
 * import { setTokenizer } from '@use-crux/core'
 * import { getEncoding } from 'js-tiktoken'
 *
 * const enc = getEncoding('cl100k_base')
 * setTokenizer((text) => enc.encode(text).length)
 * ```
 */
export function setTokenizer(fn: TokenizerFn): void {
  _tokenizer = fn
}

/**
 * Count (or estimate) the number of tokens in a string using the
 * currently configured tokenizer.
 *
 * @param text - The text to count tokens for.
 * @returns Estimated or exact token count.
 */
export function countTokens(text: string): number {
  return _tokenizer(text)
}
