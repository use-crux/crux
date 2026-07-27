import type {
  PromptTextDecorationResult,
  PromptTextDecorationSpan,
  Utf16Position,
  Utf16Range,
} from './contracts.js'
import {
  promptTextDecorationRoles,
  type PromptTextDecorationRole,
} from './types.js'

const decorationRoles: ReadonlySet<string> = new Set(promptTextDecorationRoles)
const sourceHashPattern = /^[0-9a-f]{64}$/

/**
 * Validate and detach one untrusted language-server decoration response.
 *
 * Unknown protocol versions, roles, hashes, or positions fail closed so they
 * can only clear existing decorations.
 *
 * @param value - Unknown JSON-RPC result from the language client.
 * @returns A detached version-one result, or `undefined` when invalid.
 */
export function parsePromptTextDecorationResult(
  value: unknown,
): PromptTextDecorationResult | undefined {
  if (
    !isRecord(value) ||
    value.protocolVersion !== 1 ||
    typeof value.uri !== 'string' ||
    value.uri.length === 0 ||
    !isPositiveInteger(value.openEpoch) ||
    !isInteger(value.version) ||
    typeof value.sourceHash !== 'string' ||
    !sourceHashPattern.test(value.sourceHash) ||
    !Array.isArray(value.decorations)
  )
    return undefined

  const decorations: PromptTextDecorationSpan[] = []
  for (const candidate of value.decorations) {
    const decoration = parseDecoration(candidate)
    if (decoration === undefined) return undefined
    decorations.push(decoration)
  }
  return {
    protocolVersion: 1,
    uri: value.uri,
    openEpoch: value.openEpoch,
    version: value.version,
    sourceHash: value.sourceHash,
    decorations,
  }
}

function parseDecoration(value: unknown): PromptTextDecorationSpan | undefined {
  if (!isRecord(value) || !isDecorationRole(value.role)) return undefined
  const range = parseRange(value.range)
  if (range === undefined) return undefined
  return { role: value.role, range }
}

function parseRange(value: unknown): Utf16Range | undefined {
  if (!isRecord(value)) return undefined
  const start = parsePosition(value.start)
  const end = parsePosition(value.end)
  if (
    start === undefined ||
    end === undefined ||
    comparePositions(start, end) > 0
  ) {
    return undefined
  }
  return { start, end }
}

function parsePosition(value: unknown): Utf16Position | undefined {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.line) ||
    !isNonNegativeInteger(value.character)
  )
    return undefined
  return { line: value.line, character: value.character }
}

function isDecorationRole(value: unknown): value is PromptTextDecorationRole {
  return typeof value === 'string' && decorationRoles.has(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function comparePositions(left: Utf16Position, right: Utf16Position): number {
  return left.line - right.line || left.character - right.character
}
