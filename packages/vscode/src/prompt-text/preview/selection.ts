import type { Utf16Position, Utf16Range } from '../contracts.js'
import { samePreviewRange } from './range.js'
import type { PromptTextPreviewRequests } from './requests.js'
import type { PromptTextPreviewSlotAssociation } from './slots.js'
import type {
  PromptTextPreviewControllerPorts,
  PromptTextPreviewReadyResult,
  PromptTextPreviewServerUnavailableReason,
  PromptTextPreviewSource,
} from './types.js'
import { samePromptTextPreviewStamp } from './wire.js'

/** Client-side outcome after optional Quick Pick and exact range rematch. */
export type PromptTextPreviewResolution =
  | {
      readonly kind: 'ready'
      readonly ready: PromptTextPreviewReadyResult
      readonly association?: PromptTextPreviewSlotAssociation
    }
  | {
      readonly kind: 'unavailable'
      readonly reason: PromptTextPreviewServerUnavailableReason
      readonly association?: PromptTextPreviewSlotAssociation
    }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'stale'
      readonly association?: PromptTextPreviewSlotAssociation
    }

/** Exact slot-clearing action derived from an explicit failed resolution. */
export function promptTextPreviewFailure(
  resolution: PromptTextPreviewResolution,
):
  | {
      readonly association?: PromptTextPreviewSlotAssociation
      readonly reason: PromptTextPreviewServerUnavailableReason
      readonly notify: boolean
    }
  | undefined {
  if (resolution.kind === 'unavailable') {
    return {
      association: resolution.association,
      reason: resolution.reason,
      notify: true,
    }
  }
  if (resolution.kind === 'stale' && resolution.association !== undefined) {
    return {
      association: resolution.association,
      reason: 'analysis-unavailable',
      notify: false,
    }
  }
  return undefined
}

/** Format one request-local Quick Pick row without creating identity. */
export function promptTextPreviewChoiceLabel(choice: {
  readonly ordinal: number
  readonly range: { readonly start: Utf16Position }
}): string {
  return `Template ${choice.ordinal + 1} — line ${choice.range.start.line + 1}`
}

/**
 * Resolve position and Quick Pick requests into one rematched current result.
 *
 * Request-local ordinals remain presentation-only; a choice becomes usable
 * only after the server returns the exact current template range.
 */
export async function resolvePromptTextPreview(
  source: PromptTextPreviewSource,
  position: Utf16Position,
  requests: PromptTextPreviewRequests,
  choose: PromptTextPreviewControllerPorts['choose'],
  associate: (
    range: Utf16Range,
  ) => PromptTextPreviewSlotAssociation | undefined = () => undefined,
): Promise<PromptTextPreviewResolution> {
  const first = await requests.pull(source, { kind: 'position', position })
  if (first === null) return { kind: 'cancelled' }
  if (first === undefined) {
    return { kind: 'unavailable', reason: 'analysis-unavailable' }
  }
  if (!samePromptTextPreviewStamp(first, source)) return { kind: 'stale' }
  if (first.kind === 'unavailable') {
    return { kind: 'unavailable', reason: first.reason }
  }
  if (first.kind === 'ready') return { kind: 'ready', ready: first }

  const choice = await choose(first.choices)
  if (choice === undefined) return { kind: 'cancelled' }
  const association = associate(choice.range)
  const rematched = await requests.pull(
    source,
    {
      kind: 'template-range',
      range: choice.range,
    },
    association?.slotId,
  )
  if (rematched === null) return { kind: 'cancelled' }
  if (rematched === undefined) {
    return {
      kind: 'unavailable',
      reason: 'analysis-unavailable',
      association,
    }
  }
  if (!samePromptTextPreviewStamp(rematched, source)) {
    return { kind: 'stale', association }
  }
  if (rematched.kind !== 'ready') {
    return {
      kind: 'unavailable',
      reason:
        rematched.kind === 'unavailable'
          ? rematched.reason
          : 'template-ambiguous',
      association,
    }
  }
  if (!samePreviewRange(rematched.selection.range, choice.range)) {
    return {
      kind: 'unavailable',
      reason: 'template-ambiguous',
      association,
    }
  }
  return { kind: 'ready', ready: rematched, association }
}
