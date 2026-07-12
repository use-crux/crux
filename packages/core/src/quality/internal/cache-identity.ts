/**
 * Cache identity helpers for Quality determinism.
 *
 * Epochs are intentional invalidation levers for behavior that cannot be
 * fully captured by structured identity inputs. The rule is to
 * over-invalidate rather than serve stale cassette, output-cache, or baseline
 * data.
 *
 * @internal
 * @module
 */

import { z } from 'zod'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { canonicalJson, sha256Hex } from './json'

/** Bump when normalized-call construction changes in a way not captured by its inputs. */
export const CASSETTE_CACHE_EPOCH = 2

/** Bump when cell/output cache key semantics change. */
export const OUTPUT_CACHE_EPOCH = 2

/** Bump when baseline config-fingerprint composition changes. */
export const BASELINE_FINGERPRINT_EPOCH = 1

/** Bump when the built-in judge prompt template changes. */
export const JUDGE_PROMPT_VERSION = 1

/**
 * Fingerprint a schema-like value for identity purposes.
 *
 * Zod v4 schemas use JSON Schema. Unknown Standard Schema vendors fall back
 * to enumerable own properties plus the constructor name, which may
 * over-invalidate but must not under-invalidate.
 */
export function fingerprintSchema(schema: unknown): string {
  if (schema === undefined || schema === null) return 'none'
  if (isZodSchema(schema)) {
    try {
      return sha256Hex(canonicalJson({ vendor: 'zod', schema: z.toJSONSchema(schema) }))
    } catch {
      return sha256Hex(canonicalJson({ vendor: 'zod', fallback: fingerprintValue(schema) }))
    }
  }
  const constructorName = typeof schema === 'object' && schema !== null ? schema.constructor?.name : typeof schema
  return sha256Hex(
    canonicalJson({
      vendor: constructorName ?? 'unknown',
      schema: replaceFunctionLeaves(schema),
    }),
  )
}

/**
 * Fingerprint a function by name and source text. Used when functions are
 * semantic identity inputs but are not valid canonical JSON leaves.
 */
export function fingerprintFunction(fn: (...args: never[]) => unknown): string {
  return `fn:${fn.name || 'anon'}:${sha256Hex(fn.toString())}`
}

/**
 * Fingerprint an arbitrary value after replacing functions with stable
 * function fingerprints.
 */
export function fingerprintValue(value: unknown): string {
  return sha256Hex(canonicalJson(replaceFunctionLeaves(value)))
}

function isZodSchema(value: unknown): value is z.ZodType {
  return typeof value === 'object' && value !== null && '_zod' in value
}

function replaceFunctionLeaves(value: unknown): unknown {
  if (typeof value === 'function') return fingerprintFunction(value as (...args: never[]) => unknown)
  if (value instanceof Uint8Array) return { mediaDigest: sha256Hex(Buffer.from(value).toString('base64')), byteLength: value.byteLength }
  if (value instanceof ArrayBuffer) return { mediaDigest: sha256Hex(Buffer.from(value).toString('base64')), byteLength: value.byteLength }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    // A synchronous key cannot know Blob content. A fresh nonce deliberately
    // disables cache reuse rather than colliding on size/MIME across restarts.
    return { uncacheableBlob: randomUUID() }
  }
  if (value instanceof URL) return { urlDigest: sha256Hex(value.href) }
  if (Array.isArray(value)) return value.map((item) => replaceFunctionLeaves(item))
  if (value instanceof Date) return value
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([key, entry]) => [replaceFunctionLeaves(key), replaceFunctionLeaves(entry)]))
  }
  if (value instanceof Set) return new Set([...value].map((entry) => replaceFunctionLeaves(entry)))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const replaced: Record<string, unknown> = {}
    for (const key of Object.keys(record)) {
      const entry = record[key]
      if (entry !== undefined) replaced[key] = replaceFunctionLeaves(entry)
    }
    return replaced
  }
  return value
}
