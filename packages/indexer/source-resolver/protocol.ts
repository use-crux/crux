/**
 * JSON-line worker protocol for the source resolver worker.
 *
 * The protocol parser narrows untrusted JSON through type guards and returns
 * typed outcomes. Serialization always produces exactly one JSON line so stdout
 * stays safe for the Go worker reader.
 *
 * @module
 */

import type { SourceFrameLineRole, SourceLocation } from './types'

/** Worker request accepted by `source-resolver.mjs`. */
export type SourceResolverWorkerRequest =
  | { readonly method: 'resolveLocations'; readonly locations: readonly SourceLocation[] }
  | { readonly method: 'resolveFnSource'; readonly file: string; readonly line: number; readonly column?: number }
  | {
      readonly method: 'resolveSourceFrame'
      readonly file: string
      readonly line: number
      readonly column?: number
      readonly sourceRef?: string
      readonly frameRadius?: number
      readonly role?: SourceFrameLineRole
      readonly capturedAt?: string
    }

/** Parsed worker request or a JSON-safe error. */
export type ParsedSourceResolverWorkerRequest =
  | { readonly ok: true; readonly request: SourceResolverWorkerRequest }
  | { readonly ok: false; readonly error: string }

/** Parse one JSON-line worker request into a typed command. */
export function parseSourceResolverWorkerRequest(line: string): ParsedSourceResolverWorkerRequest {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }

  if (!isRecord(value) || typeof value.method !== 'string') {
    return { ok: false, error: 'request method is required' }
  }

  if (value.method === 'resolveLocations') {
    if (!Array.isArray(value.locations) || !value.locations.every(isSourceLocation)) {
      return { ok: false, error: 'resolveLocations requires locations' }
    }
    return { ok: true, request: { method: 'resolveLocations', locations: value.locations } }
  }

  if (value.method === 'resolveFnSource') {
    if (typeof value.file !== 'string' || !isFiniteNumber(value.line)) {
      return { ok: false, error: 'resolveFnSource requires file and line' }
    }
    if (value.column !== undefined && !isFiniteNumber(value.column)) {
      return { ok: false, error: 'resolveFnSource column must be a number' }
    }
    return {
      ok: true,
      request: {
        method: 'resolveFnSource',
        file: value.file,
        line: value.line,
        column: value.column,
      },
    }
  }

  if (value.method === 'resolveSourceFrame') {
    if (typeof value.file !== 'string' || !isFiniteNumber(value.line)) {
      return { ok: false, error: 'resolveSourceFrame requires file and line' }
    }
    if (value.column !== undefined && !isFiniteNumber(value.column)) {
      return { ok: false, error: 'resolveSourceFrame column must be a number' }
    }
    if (value.frameRadius !== undefined && !isFiniteNumber(value.frameRadius)) {
      return { ok: false, error: 'resolveSourceFrame frameRadius must be a number' }
    }
    if (value.sourceRef !== undefined && typeof value.sourceRef !== 'string') {
      return { ok: false, error: 'resolveSourceFrame sourceRef must be a string' }
    }
    if (value.role !== undefined && !isSourceFrameLineRole(value.role)) {
      return { ok: false, error: 'resolveSourceFrame role is invalid' }
    }
    if (value.capturedAt !== undefined && typeof value.capturedAt !== 'string') {
      return { ok: false, error: 'resolveSourceFrame capturedAt must be a string' }
    }
    return {
      ok: true,
      request: {
        method: 'resolveSourceFrame',
        file: value.file,
        line: value.line,
        column: value.column,
        sourceRef: value.sourceRef,
        frameRadius: value.frameRadius,
        role: value.role,
        capturedAt: value.capturedAt,
      },
    }
  }

  return { ok: false, error: `unknown method: ${value.method}` }
}

/** Serialize a worker response as exactly one stdout-safe JSON line. */
export function serializeSourceResolverWorkerResponse(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

/** Convert an unknown thrown value into a stable JSON-safe message. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSourceLocation(value: unknown): value is SourceLocation {
  if (!isRecord(value)) return false
  if (typeof value.file !== 'string' || !isFiniteNumber(value.line)) return false
  if (value.column !== undefined && !isFiniteNumber(value.column)) return false
  if (value.function !== undefined && typeof value.function !== 'string') return false
  return true
}

function isSourceFrameLineRole(value: unknown): value is SourceFrameLineRole {
  return value === 'context' || value === 'failed' || value === 'passed' || value === 'not-evaluated'
}
