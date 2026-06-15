/**
 * Stream safety chunk markers.
 *
 * When stream safety transforms buffered text, core-step streaming needs to
 * emit synthetic chunks without pretending they came from the provider. The
 * marker lets `extractTextDelta()` recognize those synthetic chunks.
 *
 * @internal
 * @module
 */

const SAFETY_TEXT_CHUNK = Symbol('crux.safety.textChunk')

/** Synthetic stream chunk carrying safety-transformed text. */
export interface SafetyTextChunk {
  readonly [SAFETY_TEXT_CHUNK]: true
  readonly text: string
}

/** Create a synthetic text chunk emitted by stream safety. */
export function createSafetyTextChunk(text: string): SafetyTextChunk {
  return { [SAFETY_TEXT_CHUNK]: true, text }
}

/** Return true when a stream chunk was synthesized by Crux stream safety. */
export function isSafetyTextChunk(chunk: unknown): chunk is SafetyTextChunk {
  return typeof chunk === 'object' && chunk !== null && SAFETY_TEXT_CHUNK in chunk
}
