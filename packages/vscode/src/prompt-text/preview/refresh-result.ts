import type { Utf16Range } from '../contracts.js'
import { samePreviewRange } from './range.js'
import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewServerUnavailableReason,
  PromptTextPreviewSource,
  PromptTextPreviewStaticResult,
} from './types.js'
import { samePromptTextPreviewStamp } from './wire.js'

/** Validated outcome for a retained slot's exact-range background pull. */
export type PromptTextPreviewRefreshResult =
  | {
      readonly kind: 'discarded'
    }
  | {
      readonly kind: 'ready'
      readonly ready: PromptTextPreviewReadyResult
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: PromptTextPreviewServerUnavailableReason
    }

/**
 * Accept only a ready result matching the current source stamp and exact slot.
 *
 * Cancellation and locally superseded work are discarded. Current transport,
 * foreign-result, and malformed-selection failures clear only the origin.
 */
export function validatePromptTextPreviewRefresh(
  result: PromptTextPreviewStaticResult | undefined | null,
  source: PromptTextPreviewSource,
  current: PromptTextPreviewSource | undefined,
  range: Utf16Range,
): PromptTextPreviewRefreshResult {
  if (
    result === null ||
    current === undefined ||
    !samePromptTextPreviewStamp(source, current)
  ) {
    return { kind: 'discarded' }
  }
  if (result === undefined || !samePromptTextPreviewStamp(result, current)) {
    return { kind: 'unavailable', reason: 'analysis-unavailable' }
  }
  if (result.kind !== 'ready') {
    return {
      kind: 'unavailable',
      reason:
        result.kind === 'unavailable' ? result.reason : 'template-ambiguous',
    }
  }
  if (!samePreviewRange(result.selection.range, range)) {
    return { kind: 'unavailable', reason: 'template-ambiguous' }
  }
  return { kind: 'ready', ready: result }
}
