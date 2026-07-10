/**
 * Embedding text preprocessing and truncation.
 *
 * {@link embeddingPreprocessor} and {@link normalizeText} author preprocessors;
 * the internal helpers normalize the preprocessor config, apply preprocessors
 * in order, enforce the truncation policy + token limit, and provide the
 * default whitespace token estimate.
 *
 * @module
 */

import { stableStringify } from './hashing'
import type {
  EmbeddingGovernanceMetrics,
  EmbeddingPreprocessConfig,
  EmbeddingPreprocessor,
  EmbeddingPreprocessorConfig,
  NormalizedGovernance,
  NormalizeTextOptions,
} from './types'

/**
 * Author a custom embedding {@link EmbeddingPreprocessor}.
 *
 * @param config - Stable `id`, optional `fingerprint` (defaults to `id`), and `run`.
 * @returns A frozen preprocessor.
 */
export function embeddingPreprocessor(config: EmbeddingPreprocessorConfig): EmbeddingPreprocessor {
  if (!config.id.trim()) {
    throw new Error('Embedding preprocessor id must be non-empty.')
  }
  return Object.freeze({
    _tag: 'EmbeddingPreprocessor' as const,
    id: config.id,
    fingerprint: config.fingerprint ?? config.id,
    run: config.run,
  })
}

/**
 * Built-in preprocessor for trimming, whitespace collapse, and lowercasing.
 *
 * @param options - Which normalizations to apply (all default to `false`).
 * @returns A preprocessor whose fingerprint encodes the selected options.
 */
export function normalizeText(options: NormalizeTextOptions = {}): EmbeddingPreprocessor {
  const normalizedOptions = {
    trim: options.trim ?? false,
    collapseWhitespace: options.collapseWhitespace ?? false,
    lowercase: options.lowercase ?? false,
  }
  return embeddingPreprocessor({
    id: 'normalizeText',
    fingerprint: `normalizeText:${stableStringify(normalizedOptions)}`,
    run(text) {
      let value = text
      if (normalizedOptions.trim) {
        value = value.trim()
      }
      if (normalizedOptions.collapseWhitespace) {
        value = value.replace(/\s+/g, ' ')
      }
      if (normalizedOptions.lowercase) {
        value = value.toLowerCase()
      }
      return value
    },
  })
}

/** Normalize the preprocess config to an array of preprocessors. */
export function normalizePreprocessors(preprocess?: EmbeddingPreprocessConfig): readonly EmbeddingPreprocessor[] {
  if (!preprocess) {
    return []
  }
  return isEmbeddingPreprocessor(preprocess) ? [preprocess] : preprocess
}

/** Type guard distinguishing a single preprocessor from an array. */
function isEmbeddingPreprocessor(value: EmbeddingPreprocessConfig): value is EmbeddingPreprocessor {
  return '_tag' in value
}

/** Run each preprocessor over the text in sequence. */
export async function applyPreprocessors(
  text: string,
  preprocessors: readonly EmbeddingPreprocessor[],
): Promise<string> {
  let value = text
  for (const preprocessor of preprocessors) {
    value = await preprocessor.run(value)
  }
  return value
}

/** Apply the truncation policy, recording truncations, then enforce the token limit. */
export function applyTruncation(
  text: string,
  governance: NormalizedGovernance,
  metrics: EmbeddingGovernanceMetrics,
): string {
  if (governance.truncate.strategy === 'chars') {
    const truncated = text.length > governance.truncate.maxChars ? text.slice(0, governance.truncate.maxChars) : text
    if (truncated.length !== text.length) {
      metrics.truncatedCount = (metrics.truncatedCount ?? 0) + 1
    }
    return assertWithinTokenLimit(truncated, governance)
  }

  return assertWithinTokenLimit(text, governance)
}

/** Throw when the text exceeds `maxInputTokens` per the governance token counter. */
function assertWithinTokenLimit(text: string, governance: NormalizedGovernance): string {
  const count = governance.countTokens(text)
  if (count > 0 && count > governance.maxInputTokens) {
    throw new Error(`Embedding input exceeds maxInputTokens (${count} > ${governance.maxInputTokens}).`)
  }
  return text
}

/** Default token estimate: whitespace-delimited word count (0 for empty). */
export function estimateTokens(text: string): number {
  const trimmed = text.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}
