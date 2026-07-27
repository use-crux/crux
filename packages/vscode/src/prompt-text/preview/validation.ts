import type { Utf16Position, Utf16Range } from '../contracts.js'
import type {
  PromptTextPreviewSelection,
  PromptTextPreviewTruncation,
  PromptTextPreviewUnavailableResult,
} from './types.js'

const sourceHashPattern = /^[0-9a-f]{64}$/
const lspIntegerMaximum = 2_147_483_647
const lspIntegerMinimum = -2_147_483_648

/** Decode a complete, exact-key truncation record with nonnegative byte units. */
export function parseTruncation(
  value: unknown,
): PromptTextPreviewTruncation | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['reason', 'limit', 'emittedBytes']) ||
    (value.reason !== 'max-preview-bytes' &&
      value.reason !== 'max-fragment-depth') ||
    !isSafeIntegerBetween(value.limit, 0, lspIntegerMaximum) ||
    !isSafeIntegerBetween(value.emittedBytes, 0, lspIntegerMaximum)
  ) {
    return undefined
  }
  return {
    reason: value.reason,
    limit: value.limit,
    emittedBytes: value.emittedBytes,
  }
}

/** Decode the required V1 document stamp without accepting partial identity. */
export function parseStamp(value: Readonly<Record<string, unknown>>) {
  if (
    value.protocolVersion !== 1 ||
    typeof value.uri !== 'string' ||
    value.uri.length === 0 ||
    !isSafeIntegerBetween(value.openEpoch, 1, Number.MAX_SAFE_INTEGER) ||
    !isSafeIntegerBetween(
      value.version,
      lspIntegerMinimum,
      lspIntegerMaximum,
    ) ||
    typeof value.sourceHash !== 'string' ||
    !sourceHashPattern.test(value.sourceHash)
  ) {
    return undefined
  }
  return {
    protocolVersion: 1 as const,
    uri: value.uri,
    openEpoch: value.openEpoch,
    version: value.version,
    sourceHash: value.sourceHash,
  }
}

/** Decode a nonempty UTF-16 selection range and nonnegative ordinal. */
export function parseSelection(
  value: unknown,
): PromptTextPreviewSelection | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['ordinal', 'range']) ||
    !isSafeIntegerBetween(value.ordinal, 0, lspIntegerMaximum)
  ) {
    return undefined
  }
  const range = parseRange(value.range)
  return range === undefined ? undefined : { ordinal: value.ordinal, range }
}

/** Require every named field and reject every field outside the exact schema. */
export function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional])
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  )
}

/** Narrow plain JSON objects while rejecting arrays and null. */
export function isRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow request/template structure statuses accepted by the V1 wire. */
export function isStructuralStatus(
  value: unknown,
): value is 'complete' | 'truncated' {
  return value === 'complete' || value === 'truncated'
}

/** Narrow preview content statuses accepted by the V1 wire. */
export function isContentStatus(
  value: unknown,
): value is 'complete' | 'truncated' {
  return value === 'complete' || value === 'truncated'
}

/** Narrow preview evidence to the two exactness levels in the V1 wire. */
export function isEvidence(
  value: unknown,
): value is 'syntax-exact' | 'semantic-exact' {
  return value === 'syntax-exact' || value === 'semantic-exact'
}

/** Reject unavailable reasons not explicitly owned by the server contract. */
export function isServerUnavailableReason(
  value: unknown,
): value is PromptTextPreviewUnavailableResult['reason'] {
  return (
    value === 'document-not-open' ||
    value === 'revision-mismatch' ||
    value === 'analysis-unavailable' ||
    value === 'request-unsupported' ||
    value === 'template-not-found' ||
    value === 'template-ambiguous' ||
    value === 'template-unsupported' ||
    value === 'preview-unavailable'
  )
}

/** Compare UTF-16 ranges by start and then end in LSP source order. */
export function compareRange(left: Utf16Range, right: Utf16Range): number {
  return compare(left.start, right.start) || compare(left.end, right.end)
}

function parseRange(value: unknown): Utf16Range | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ['start', 'end']))
    return undefined
  const start = parsePosition(value.start)
  const end = parsePosition(value.end)
  if (start === undefined || end === undefined || compare(start, end) >= 0) {
    return undefined
  }
  return { start, end }
}

function parsePosition(value: unknown): Utf16Position | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['line', 'character']) ||
    !isSafeIntegerBetween(value.line, 0, lspIntegerMaximum) ||
    !isSafeIntegerBetween(value.character, 0, lspIntegerMaximum)
  ) {
    return undefined
  }
  return { line: value.line, character: value.character }
}

function isSafeIntegerBetween(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  )
}

function compare(left: Utf16Position, right: Utf16Position): number {
  return left.line - right.line || left.character - right.character
}
