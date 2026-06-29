/**
 * System and prompt text normalization for prompt resolution.
 *
 * Dynamic system text may be plain strings or structured segments. This module
 * normalizes both forms and infers dynamic input segments for plain template
 * output where a primitive input value can be traced unambiguously.
 *
 * @module
 */

import type { ContextSystemContent, ContextSystemResult, ContextTextSegment } from '../prompt/context-types'
import type { ResolvedSystemContent } from './contract'

/** Token estimator injected by the caller — the resolver passes `ports.tokenizer.count`. */
type CountTokens = (text: string) => number

/** Render a prompt/system string or callback against the resolved input. */
export async function renderPromptText<T>(
  value: string | ((arg: { input: T }) => string | Promise<string>) | undefined,
  input: T,
): Promise<string> {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  const result = await value({ input })
  if (result != null && typeof result !== 'string') {
    throw new Error(
      `Prompt system/prompt function must return a string, got ${typeof result}. ` +
        `Value: ${JSON.stringify(result).slice(0, 200)}`,
    )
  }
  return result ?? ''
}

function isContextSystemContent(value: unknown): value is ContextSystemContent {
  return typeof value === 'object' && value !== null && Array.isArray((value as { segments?: unknown }).segments)
}

/**
 * Normalize a prompt or context system contribution into text plus segments.
 *
 * `count` estimates the static/dynamic token split — the caller threads the
 * resolver's `TokenizerPort.count` so segment token attribution follows the
 * same estimator as every other budget decision.
 */
export function normalizeSystemContent(
  value: ContextSystemResult | null | undefined,
  fallbackDynamic: boolean,
  count: CountTokens,
  errorLabel = 'Prompt system/context function',
  inferenceInput?: unknown,
): ResolvedSystemContent {
  if (value === undefined || value === null) return { text: '' }
  if (typeof value === 'string') {
    if (!value) return { text: '' }
    if (fallbackDynamic) {
      const inferredSegments = inferInputValueSegments(value, inferenceInput)
      if (inferredSegments.length > 0) return segmentsToSystemContent(inferredSegments, count)
    }
    return segmentsToSystemContent([{ text: value, dynamic: fallbackDynamic }], count)
  }
  if (!isContextSystemContent(value)) {
    throw new Error(
      `${errorLabel} must return a string or { segments }, got ${typeof value}. ` +
        `Value: ${JSON.stringify(value).slice(0, 200)}`,
    )
  }
  return segmentsToSystemContent(value.segments, count)
}

/** Resolve and normalize a prompt-owned system contribution. */
export async function resolveSystemContent<T>(
  value:
    | string
    | ContextSystemContent
    | ((arg: { input: T }) => ContextSystemResult | Promise<ContextSystemResult>)
    | undefined,
  input: T,
  count: CountTokens,
): Promise<ResolvedSystemContent> {
  if (value === undefined) return { text: '' }
  if (typeof value === 'string') return normalizeSystemContent(value, false, count)
  if (isContextSystemContent(value)) return normalizeSystemContent(value, false, count)
  const result = await value({ input })
  return normalizeSystemContent(result, true, count, 'Prompt system/context function', input)
}

/**
 * Re-estimate a cached content's static/dynamic token split with `count`.
 *
 * Segments (text + dynamic flags) come from the system function and are
 * tokenizer-independent, so they are safe to cache — but their token counts are
 * not. A context-cache hit under a different `TokenizerPort` must refresh the
 * split so `staticTokens` / `dynamicTokens` stay aligned with the active
 * tokenizer for inspect attribution. Content without segments has no split to
 * refresh and is returned unchanged.
 */
export function recountSystemContent(content: ResolvedSystemContent, count: CountTokens): ResolvedSystemContent {
  if (!content.segments || content.segments.length === 0) return content
  return segmentsToSystemContent(content.segments, count)
}

/** Select only the input fields a context declared for segment inference. */
export function inputForSourceKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined
  const picked: Record<string, unknown> = {}
  for (const key of keys) {
    if (key in input) picked[key] = input[key]
  }
  return Object.keys(picked).length > 0 ? picked : undefined
}

interface PrimitiveInputValue {
  source: string
  value: string
}

function inferInputValueSegments(text: string, input: unknown): ContextTextSegment[] {
  const values = uniquePrimitiveInputValues(input)
  if (values.length === 0) return []
  const matches: Array<{ start: number; end: number; source: string; value: string }> = []
  for (const entry of values) {
    let start = text.indexOf(entry.value)
    while (start >= 0) {
      matches.push({ start, end: start + entry.value.length, source: entry.source, value: entry.value })
      start = text.indexOf(entry.value, start + entry.value.length)
    }
  }
  if (matches.length === 0) return []

  const selected: typeof matches = []
  for (const match of matches.sort(
    (left, right) => left.start - right.start || right.value.length - left.value.length,
  )) {
    const overlaps = selected.some((existing) => match.start < existing.end && match.end > existing.start)
    if (!overlaps) selected.push(match)
  }
  selected.sort((left, right) => left.start - right.start)

  const segments: ContextTextSegment[] = []
  let cursor = 0
  for (const match of selected) {
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), dynamic: false })
    segments.push({ text: text.slice(match.start, match.end), dynamic: true, source: match.source })
    cursor = match.end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), dynamic: false })
  return segments
}

function uniquePrimitiveInputValues(input: unknown): PrimitiveInputValue[] {
  const values = collectPrimitiveInputValues(input)
  const byValue = new Map<string, PrimitiveInputValue[]>()
  for (const value of values) {
    if (value.value.trim().length === 0) continue
    const bucket = byValue.get(value.value) ?? []
    bucket.push(value)
    byValue.set(value.value, bucket)
  }
  return [...byValue.values()]
    .filter((bucket) => bucket.length === 1)
    .map((bucket) => bucket[0]!)
    .sort((left, right) => right.value.length - left.value.length || left.source.localeCompare(right.source))
}

function collectPrimitiveInputValues(
  input: unknown,
  path: string[] = [],
  seen = new WeakSet<object>(),
): PrimitiveInputValue[] {
  if (path.length === 0 && (input === null || input === undefined)) return []
  if (
    typeof input === 'string' ||
    typeof input === 'number' ||
    typeof input === 'boolean' ||
    typeof input === 'bigint'
  ) {
    return path.length > 0 ? [{ source: path.join('.'), value: String(input) }] : []
  }
  if (input instanceof Date) {
    return path.length > 0 ? [{ source: path.join('.'), value: input.toISOString() }] : []
  }
  if (input === null || typeof input !== 'object') return []
  if (seen.has(input)) return []
  seen.add(input)

  const out: PrimitiveInputValue[] = []
  if (Array.isArray(input)) {
    input.forEach((value, index) => out.push(...collectPrimitiveInputValues(value, [...path, String(index)], seen)))
    return out
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out.push(...collectPrimitiveInputValues(value, [...path, key], seen))
  }
  return out
}

function segmentsToSystemContent(segments: readonly ContextTextSegment[], count: CountTokens): ResolvedSystemContent {
  const normalized = segments
    .filter((segment) => segment.text.length > 0)
    .map((segment) => ({
      text: segment.text,
      dynamic: segment.dynamic,
      ...(segment.source ? { source: segment.source } : {}),
    }))
  const text = normalized.map((segment) => segment.text).join('')
  const staticTokens = normalized
    .filter((segment) => !segment.dynamic)
    .reduce((total, segment) => total + count(segment.text), 0)
  const dynamicTokens = normalized
    .filter((segment) => segment.dynamic)
    .reduce((total, segment) => total + count(segment.text), 0)
  return {
    text,
    ...(normalized.length > 0 ? { segments: normalized } : {}),
    ...(normalized.length > 0 ? { staticTokens, dynamicTokens } : {}),
  }
}
