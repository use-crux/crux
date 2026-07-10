/**
 * Source-frame enrichment for Quality assertion outcomes.
 *
 * The assertion recorder captures stack-derived source refs while user code
 * runs. This module keeps the async resolver plumbing out of the large engine
 * and applies honest degradation when a resolver cannot produce authored
 * source.
 *
 * @internal Not exported from `@use-crux/core/quality` - engine plumbing only.
 * @module
 */

import type { CellAssertionOutcome, CellAssertionStatus } from '../experiment'
import type { QualitySourceFrame, QualitySourceFrameRequest, QualitySourceFrameResolver } from '../source-frame'

const DEFAULT_FRAME_RADIUS = 4
const EXPECT_CALL_TOKENS = ['expect.soft(', 'expect('] as const

type QuoteDelimiter = "'" | '"' | '`'

interface ExpectCallCandidate {
  readonly start: number
  readonly argumentStart: number
}

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
      const sourceFrame = await resolveSourceFrameFromSourceRef({
        sourceRef: outcome.sourceRef,
        resolver,
        frameRadius,
        capturedAt,
        role: roleForStatus(outcome.status),
      })
      const subjectExpr = outcome.subjectExpr ?? subjectExpressionFromSourceFrame(sourceFrame)
      return {
        ...outcome,
        ...(subjectExpr !== undefined ? { subjectExpr } : {}),
        sourceFrame,
      }
    }),
  )
}

/** Resolve one stack-derived source ref into a source-frame result. @internal */
export async function resolveSourceFrameFromSourceRef(input: {
  readonly sourceRef: string | undefined
  readonly resolver: QualitySourceFrameResolver
  readonly frameRadius?: number
  readonly capturedAt?: string
  readonly role: QualitySourceFrameRequest['role']
}): Promise<QualitySourceFrame> {
  const request = requestFromSourceRef(
    input.sourceRef,
    input.frameRadius ?? DEFAULT_FRAME_RADIUS,
    input.capturedAt ?? new Date().toISOString(),
    input.role,
  )
  if (request === undefined) {
    return { kind: 'unavailable', reason: 'no-source-ref' }
  }
  try {
    return await input.resolver.resolveSourceFrame(request)
  } catch {
    return { kind: 'unavailable', reason: 'source-file-missing' }
  }
}

function requestFromSourceRef(
  sourceRef: string | undefined,
  frameRadius: number,
  capturedAt: string,
  role: QualitySourceFrameRequest['role'],
): QualitySourceFrameRequest | undefined {
  if (sourceRef === undefined) return undefined
  const location = parseSourceRef(sourceRef)
  if (location === undefined) return undefined
  return {
    sourceRef,
    file: location.file,
    line: location.line,
    ...(location.column !== undefined ? { column: location.column } : {}),
    frameRadius,
    capturedAt,
    role,
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

/**
 * Recover the authored `expect(<subject>)` argument from a narrow source frame.
 *
 * The frame is already the durable evidence snapshot; this helper avoids keeping
 * whole source files in experiment records while still letting UI surfaces render
 * the subject side of assertion rows.
 */
function subjectExpressionFromSourceFrame(sourceFrame: QualitySourceFrame): string | undefined {
  if (sourceFrame.kind !== 'source-frame') return undefined

  const authoredLineIndex = sourceFrame.lines.findIndex((line) => line.line === sourceFrame.authoredLine)
  if (authoredLineIndex === -1) return undefined

  const sourceText = sourceFrame.lines
    .slice(authoredLineIndex)
    .map((line) => line.text)
    .join('\n')
  const candidate = findExpectCallCandidate(sourceText, sourceFrame.authoredColumn)
  if (candidate === undefined) return undefined

  return extractBalancedArgument(sourceText, candidate.argumentStart)
}

function findExpectCallCandidate(
  sourceText: string,
  authoredColumn: number | undefined,
): ExpectCallCandidate | undefined {
  const candidates: ExpectCallCandidate[] = []

  for (const token of EXPECT_CALL_TOKENS) {
    let start = sourceText.indexOf(token)
    while (start !== -1) {
      if (isExpectTokenBoundary(sourceText, start)) {
        candidates.push({ start, argumentStart: start + token.length })
      }
      start = sourceText.indexOf(token, start + token.length)
    }
  }

  if (candidates.length === 0) return undefined

  const ordered = [...candidates].sort((left, right) => left.start - right.start)
  if (authoredColumn === undefined) return ordered[0]

  const nearestBeforeColumn = ordered.filter((candidate) => candidate.start <= authoredColumn).at(-1)
  return nearestBeforeColumn ?? ordered[0]
}

function isExpectTokenBoundary(sourceText: string, start: number): boolean {
  const previous = sourceText[start - 1]
  return previous === undefined || !isIdentifierCharacter(previous)
}

function isIdentifierCharacter(character: string): boolean {
  return /[A-Za-z0-9_$]/.test(character)
}

function extractBalancedArgument(sourceText: string, argumentStart: number): string | undefined {
  let depth = 1
  let quote: QuoteDelimiter | undefined
  let escaped = false

  for (let index = argumentStart; index < sourceText.length; index += 1) {
    const character = sourceText[index]
    if (character === undefined) continue

    if (quote !== undefined) {
      if (escaped) {
        escaped = false
        continue
      }
      if (character === '\\') {
        escaped = true
        continue
      }
      if (character === quote) quote = undefined
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth -= 1
      if (depth === 0) {
        const subjectExpr = sourceText.slice(argumentStart, index).trim()
        return subjectExpr === '' ? undefined : subjectExpr
      }
    }
  }

  return undefined
}
