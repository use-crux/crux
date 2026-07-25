import type { BoundaryDef } from '../boundary'
import type { SafetyUnitKind, SegmentOptions } from '../output/output-boundaries'

/** Return the next complete prefix segment to evaluate, or `null` while holding. */
export type StreamSegment = (buffer: string, last: boolean) => string | null

/** The streaming text units the segment engine can stage. `complete` is not staged. */
export type TextUnitKind = 'delta' | 'complete' | 'sentence' | 'line' | 'segment'

const TEXT_UNITS: ReadonlySet<string> = new Set(['delta', 'complete', 'sentence', 'line', 'segment'])

/** The effective streaming text unit for a text boundary, with its resolution source. */
export interface ResolvedTextUnit {
  readonly unit: TextUnitKind
  readonly source: 'explicit' | 'strategy' | 'adaptive'
  readonly options?: SegmentOptions | { readonly maxHold?: { readonly chars?: number; readonly ms?: number } }
}

/** The execution surface a text unit is resolved for. */
export type TextReplayMode = 'generate' | 'stream'

/**
 * Resolve the effective text unit (algorithm G): an explicit boundary refinement
 * wins, then a bundled strategy's semantic default, then the adaptive default.
 * The adaptive default is mode-specific — a generate result is evaluated once
 * when complete, a stream once per canonical delta.
 */
export function resolveTextUnit(
  boundary: BoundaryDef,
  strategyDefaultUnit: SafetyUnitKind | undefined,
  mode: TextReplayMode = 'stream',
): ResolvedTextUnit {
  const explicit = (boundary as { readonly unit?: SafetyUnitKind }).unit
  if (explicit && TEXT_UNITS.has(explicit)) {
    const options = (boundary as { readonly options?: ResolvedTextUnit['options'] }).options
    return { unit: explicit as TextUnitKind, source: 'explicit', ...(options ? { options } : {}) }
  }
  if (strategyDefaultUnit && TEXT_UNITS.has(strategyDefaultUnit)) {
    return { unit: strategyDefaultUnit as TextUnitKind, source: 'strategy' }
  }
  return { unit: mode === 'generate' ? 'complete' : 'delta', source: 'adaptive' }
}

/** The staged segmenter for a resolved growing text unit (`complete` is handled at finalization). */
export function segmenterForUnit(resolved: ResolvedTextUnit): StreamSegment {
  switch (resolved.unit) {
    case 'line':
      return lineSegment
    case 'sentence':
      return sentenceSegment
    case 'segment':
      return customSegment(resolved.options as SegmentOptions)
    default:
      return chunkSegment
  }
}

/** Maximum buffered characters allowed before a holding stream unit fails closed. */
export function maxHoldCharsForUnit(resolved: ResolvedTextUnit): number {
  const options = resolved.options as { readonly maxHold?: { readonly chars?: number } } | undefined
  return options?.maxHold?.chars ?? 2000
}

/**
 * Maximum elapsed monotonic milliseconds a stream unit may hold before failing
 * closed, or `undefined` when no `ms` limit is configured (there is no implicit
 * wall-clock default).
 */
export function maxHoldMsForUnit(resolved: ResolvedTextUnit): number | undefined {
  const options = resolved.options as { readonly maxHold?: { readonly ms?: number } } | undefined
  return options?.maxHold?.ms
}

function chunkSegment(buffer: string): string | null {
  // Each delta is a complete unit; nothing is ever held across deltas.
  return buffer.length > 0 ? buffer : null
}

function lineSegment(buffer: string, final: boolean): string | null {
  const index = buffer.indexOf('\n')
  if (index >= 0) return buffer.slice(0, index + 1)
  // The final unterminated line completes at EOF.
  return final && buffer.length > 0 ? buffer : null
}

function sentenceSegment(buffer: string, final: boolean): string | null {
  const match = /[.!?]\s|\n/.exec(buffer)
  if (match) return buffer.slice(0, match.index + match[0].length)
  // The final unterminated sentence completes at EOF.
  return final && buffer.length > 0 ? buffer : null
}

function customSegment(options: SegmentOptions): StreamSegment {
  return (buffer, final) => {
    // `final` is true only during EOF flushing, letting the segmenter complete a
    // trailing unterminated unit; `undefined` retains more input (held at EOF).
    const length = options.next(buffer, { final })
    if (length === undefined || length <= 0) return null
    return buffer.slice(0, Math.min(length, buffer.length))
  }
}
