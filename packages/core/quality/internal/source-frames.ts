/**
 * Source-frame enrichment for Quality assertion outcomes.
 *
 * The assertion recorder captures stack-derived source refs while user code
 * runs. This module keeps the async resolver plumbing out of the large engine
 * and applies honest degradation when a resolver cannot produce authored
 * source.
 *
 * @internal Not exported from `@crux/core/quality` - engine plumbing only.
 * @module
 */

import type { CellAssertionOutcome, CellAssertionStatus } from '../experiment'
import type { QualitySourceFrameRequest, QualitySourceFrameResolver } from '../source-frame'

const DEFAULT_FRAME_RADIUS = 4

/** Add source-frame snapshots to assertion outcomes when a resolver is supplied. */
export async function resolveAssertionSourceFrames(input: {
  readonly outcomes: readonly CellAssertionOutcome[]
  readonly resolver?: QualitySourceFrameResolver
  readonly frameRadius?: number
}): Promise<CellAssertionOutcome[]> {
  const resolver = input.resolver
  if (resolver === undefined || input.outcomes.length === 0) return [...input.outcomes]

  const capturedAt = new Date().toISOString()
  const frameRadius = input.frameRadius ?? DEFAULT_FRAME_RADIUS

  return Promise.all(
    input.outcomes.map(async (outcome) => {
      const request = requestFromOutcome(outcome, frameRadius, capturedAt)
      if (request === undefined) {
        return { ...outcome, sourceFrame: { kind: 'unavailable', reason: 'no-source-ref' } }
      }
      try {
        const sourceFrame = await resolver.resolveSourceFrame(request)
        return { ...outcome, sourceFrame }
      } catch {
        return { ...outcome, sourceFrame: { kind: 'unavailable', reason: 'source-file-missing' } }
      }
    }),
  )
}

function requestFromOutcome(
  outcome: CellAssertionOutcome,
  frameRadius: number,
  capturedAt: string,
): QualitySourceFrameRequest | undefined {
  if (outcome.sourceRef === undefined) return undefined
  const location = parseSourceRef(outcome.sourceRef)
  if (location === undefined) return undefined
  return {
    sourceRef: outcome.sourceRef,
    file: location.file,
    line: location.line,
    ...(location.column !== undefined ? { column: location.column } : {}),
    frameRadius,
    capturedAt,
    role: roleForStatus(outcome.status),
  }
}

function parseSourceRef(
  sourceRef: string,
): { readonly file: string; readonly line: number; readonly column?: number } | undefined {
  const match = /^(.*):(\d+):(\d+)$/.exec(sourceRef)
  if (match === null) return undefined

  const line = Number(match[2])
  const column = Number(match[3])
  if (match[1] === '' || !Number.isInteger(line) || line < 1 || !Number.isInteger(column) || column < 0) {
    return undefined
  }
  return { file: match[1], line, column }
}

function roleForStatus(status: CellAssertionStatus): QualitySourceFrameRequest['role'] {
  switch (status) {
    case 'passed':
      return 'passed'
    case 'failed':
    case 'uncaptured':
      return 'failed'
    case 'not-evaluated':
      return 'not-evaluated'
  }
}
