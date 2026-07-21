import type { CruxAttributes, CruxErrorSummary } from './contract'
import { projectErrorForObservation } from './error-projection'
import { sanitizeMediaPreview } from './media-preview'

const DEFAULT_MAX_DEPTH = 6
const DEFAULT_MAX_KEYS = 80
const DEFAULT_MAX_ARRAY_ITEMS = 80
const DEFAULT_MAX_STRING_LENGTH = 8_000
const REDACTED_VALUE = '[redacted]'
const CIRCULAR_VALUE = '[Circular]'
const TRUNCATED_VALUE = '[Truncated]'

const SENSITIVE_KEY_PATTERN = /authorization|cookie|set-cookie|token|secret|password|api[-_]?key|apikey/i

export interface ObservedErrorContext {
  readonly phase?: string
  readonly errorKind?: string
  readonly attributes?: CruxAttributes
}

export interface NormalizedObservedCause {
  readonly message: string
  readonly name?: string
  readonly stack?: string
  readonly raw?: unknown
}

export type NormalizedObservedError =
  | {
      readonly thrown: 'error'
      readonly summary: CruxErrorSummary
      readonly stack?: string
      readonly raw: Record<string, unknown>
      readonly cause?: NormalizedObservedCause
    }
  | {
      readonly thrown: 'value'
      readonly summary: CruxErrorSummary
      readonly raw: unknown
    }

interface SafeJsonOptions {
  readonly maxDepth: number
  readonly maxKeys: number
  readonly maxArrayItems: number
  readonly maxStringLength: number
}

const defaultSafeJsonOptions: SafeJsonOptions = {
  maxDepth: DEFAULT_MAX_DEPTH,
  maxKeys: DEFAULT_MAX_KEYS,
  maxArrayItems: DEFAULT_MAX_ARRAY_ITEMS,
  maxStringLength: DEFAULT_MAX_STRING_LENGTH,
}

export function normalizeObservedError(error: unknown, context: ObservedErrorContext = {}): NormalizedObservedError {
  error = projectErrorForObservation(error)
  if (error instanceof Error) {
    const summary = errorSummaryFromRecord(error, context)
    const stack = nonEmptyString(error.stack)
    const cause = normalizeCause(error.cause)

    return {
      thrown: 'error',
      summary,
      ...(stack ? { stack } : {}),
      raw: errorToRawRecord(error),
      ...(cause ? { cause } : {}),
    }
  }

  return {
    thrown: 'value',
    summary: errorSummaryFromRecord(error, context),
    raw: toSafeJsonValue(error),
  }
}

export function observedErrorSummary(error: unknown, context: ObservedErrorContext = {}): CruxErrorSummary {
  return normalizeObservedError(error, context).summary
}

export function toSafeJsonValue(value: unknown): unknown {
  return toSafeJsonValueInternal(sanitizeMediaPreview(value), defaultSafeJsonOptions, 0, new WeakSet<object>())
}

function errorSummaryFromRecord(error: unknown, context: ObservedErrorContext): CruxErrorSummary {
  const record = isRecord(error) ? error : undefined
  const message = errorMessage(error)
  const name = error instanceof Error ? nonEmptyString(error.name) : stringProperty(record, 'name')
  const category =
    stringProperty(record, 'category') ??
    stringProperty(record, 'code') ??
    context.errorKind ??
    stringProperty(context.attributes, 'errorKind')
  const retryable = booleanProperty(record, 'retryable') ?? booleanProperty(context.attributes, 'retryable')
  const statusCode =
    numberProperty(record, 'statusCode') ??
    numberProperty(record, 'status') ??
    numberProperty(context.attributes, 'statusCode')

  return {
    message,
    ...(name ? { name } : {}),
    ...(category ? { category } : {}),
    ...(retryable === undefined ? {} : { retryable }),
    ...(statusCode === undefined ? {} : { statusCode }),
  }
}

function normalizeCause(cause: unknown): NormalizedObservedCause | undefined {
  if (cause === undefined) return undefined
  cause = projectErrorForObservation(cause)
  if (cause instanceof Error) {
    const stack = nonEmptyString(cause.stack)
    const name = nonEmptyString(cause.name)
    return {
      message: errorMessage(cause),
      ...(name ? { name } : {}),
      ...(stack ? { stack } : {}),
    }
  }

  return {
    message: errorMessage(cause),
    raw: toSafeJsonValue(cause),
  }
}

function errorToRawRecord(error: Error): Record<string, unknown> {
  const customFields = error as Error & Record<string, unknown>
  const raw: Record<string, unknown> = {
    name: error.name,
    message: errorMessage(error),
  }
  if (error.stack) raw.stack = error.stack
  if (error.cause !== undefined) raw.cause = toSafeJsonValue(error.cause)

  for (const key of Object.keys(error)) {
    if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue
    raw[key] = redactedOrSafeValue(key, getRecordValue(customFields, key))
  }

  return raw
}

function toSafeJsonValueInternal(
  value: unknown,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) return null
  if (value === undefined) return null

  if (typeof value === 'string') return truncateString(value, options.maxStringLength)
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return `[Function${value.name ? `:${value.name}` : ''}]`

  if (!isRecord(value)) return String(value)

  if (seen.has(value)) return CIRCULAR_VALUE
  if (depth >= options.maxDepth) return TRUNCATED_VALUE

  seen.add(value)
  try {
    if (value instanceof Error) return errorObjectToSafeJsonValue(value, options, depth, seen)
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
    if (value instanceof RegExp) return String(value)
    if (Array.isArray(value)) return arrayToSafeJsonValue(value, options, depth, seen)
    if (value instanceof Map) return mapToSafeJsonValue(value, options, depth, seen)
    if (value instanceof Set) return setToSafeJsonValue(value, options, depth, seen)

    return objectToSafeJsonValue(value, options, depth, seen)
  } finally {
    seen.delete(value)
  }
}

function errorObjectToSafeJsonValue(
  error: Error,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const customFields = error as Error & Record<string, unknown>
  const result: Record<string, unknown> = {
    name: error.name,
    message: errorMessage(error),
  }
  if (error.stack) result.stack = truncateString(error.stack, options.maxStringLength)
  if (error.cause !== undefined) {
    result.cause = toSafeJsonValueInternal(error.cause, options, depth + 1, seen)
  }

  copySafeEntries(result, customFields, options, depth, seen)
  return result
}

function arrayToSafeJsonValue(
  value: readonly unknown[],
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown[] {
  const result = value
    .slice(0, options.maxArrayItems)
    .map((item) => toSafeJsonValueInternal(item, options, depth + 1, seen))
  if (value.length > options.maxArrayItems) result.push(TRUNCATED_VALUE)
  return result
}

function mapToSafeJsonValue(
  value: Map<unknown, unknown>,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  let count = 0
  for (const [key, item] of value.entries()) {
    if (count >= options.maxKeys) {
      result.__truncated = true
      break
    }
    const safeKey =
      typeof key === 'string' ? key : JSON.stringify(toSafeJsonValueInternal(key, options, depth + 1, seen))
    result[safeKey ?? String(key)] = redactedOrSafeValue(String(key), item, options, depth, seen)
    count += 1
  }
  return result
}

function setToSafeJsonValue(
  value: Set<unknown>,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): unknown[] {
  return arrayToSafeJsonValue(Array.from(value.values()), options, depth, seen)
}

function objectToSafeJsonValue(
  value: Record<string, unknown>,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  copySafeEntries(result, value, options, depth, seen)
  return result
}

function copySafeEntries(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  options: SafeJsonOptions,
  depth: number,
  seen: WeakSet<object>,
): void {
  let count = 0
  for (const key of Object.keys(source)) {
    if (count >= options.maxKeys) {
      target.__truncated = true
      return
    }
    target[key] = redactedOrSafeValue(key, source[key], options, depth, seen)
    count += 1
  }
}

function redactedOrSafeValue(
  key: string,
  value: unknown,
  options: SafeJsonOptions = defaultSafeJsonOptions,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED_VALUE
  return toSafeJsonValueInternal(sanitizeMediaPreview(value), options, depth + 1, seen)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return nonEmptyString(error.message) ?? error.name ?? 'Error'

  if (isRecord(error)) {
    const message = stringProperty(error, 'message')
    if (message) return message
  }

  if (typeof error === 'string') return error
  if (error === null) return 'null'
  if (error === undefined) return 'undefined'

  try {
    return String(error)
  } catch {
    return 'Unknown thrown value'
  }
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...${TRUNCATED_VALUE}`
}

function stringProperty(record: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!record) return undefined
  return nonEmptyString(record[key])
}

function booleanProperty(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  if (!record) return undefined
  return typeof record[key] === 'boolean' ? record[key] : undefined
}

function numberProperty(record: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!record) return undefined
  const value = record[key]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getRecordValue(record: Record<string, unknown>, key: string): unknown {
  return record[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
