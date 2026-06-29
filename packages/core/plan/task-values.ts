/**
 * JSON and schema guards for task data that crosses the store boundary.
 *
 * These checks reject values that JSON serialization would drop, coerce, or
 * fail to represent, so persisted task data stays portable across adapters.
 *
 * @module
 */

import type { JsonValue } from '../types/tool'
import { TaskJsonValueError, TaskResultValidationError } from './errors'
import type { TaskSpec, TaskResultSchema } from './types'

/** Context for a task value that is about to be persisted. */
export interface TaskJsonValueContext {
  /** Task ledger ID involved in the write. */
  taskListId: string
  /** Task ID involved in the write, when scoped to a task row. */
  taskId?: string
  /** Human-readable field name used in error messages. */
  field: string
}

/** Parse and JSON-check a completion result against an optional task spec. */
export function parseTaskCompletionResult(args: {
  taskListId: string
  taskId: string
  spec?: TaskSpec<TaskResultSchema | undefined>
  result: JsonValue | undefined
}): JsonValue | undefined {
  if (args.spec?.result !== undefined) {
    const parsed = args.spec.result.safeParse(args.result)
    if (!parsed.success) {
      throw TaskResultValidationError(args.taskListId, args.taskId, parsed.error.message)
    }
    assertTaskJsonValue(parsed.data, {
      taskListId: args.taskListId,
      taskId: args.taskId,
      field: 'result',
    })
    return parsed.data
  }

  if (args.result !== undefined) {
    assertTaskJsonValue(args.result, {
      taskListId: args.taskListId,
      taskId: args.taskId,
      field: 'result',
    })
  }
  return args.result
}

/** Assert that a value is JSON-safe before it is written to the task store. */
export function assertTaskJsonValue(value: unknown, context: TaskJsonValueContext): asserts value is JsonValue {
  const failure = findJsonFailure(value, '$', new WeakSet<object>())
  if (failure) {
    throw TaskJsonValueError(
      context.taskListId,
      context.taskId,
      `Task ${context.field} must be JSON-safe: ${failure}`,
    )
  }
}

function findJsonFailure(value: unknown, path: string, seen: WeakSet<object>): string | null {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return null
    case 'number':
      return Number.isFinite(value) ? null : `${path} is not a finite number`
    case 'undefined':
      return `${path} is undefined`
    case 'bigint':
      return `${path} is a bigint`
    case 'symbol':
      return `${path} is a symbol`
    case 'function':
      return `${path} is a function`
    case 'object':
      return findJsonObjectFailure(value, path, seen)
  }
  return `${path} has unsupported type`
}

function findJsonObjectFailure(value: object, path: string, seen: WeakSet<object>): string | null {
  if (seen.has(value)) return `${path} is cyclic`
  seen.add(value)

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const failure = findJsonFailure(item, `${path}[${index}]`, seen)
      if (failure) return failure
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length' || isArrayIndexKey(key)) continue
      if (typeof key === 'symbol') return `${path} has symbol-keyed property`
      return `${path}.${key} is not serialized by JSON arrays`
    }
    seen.delete(value)
    return null
  }

  if (!isPlainObject(value)) return `${path} is not a plain object`

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') return `${path} has symbol-keyed property`
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable) return `${path}.${key} is not enumerable`
    const item = (value as Record<string, unknown>)[key]
    const failure = findJsonFailure(item, `${path}.${key}`, seen)
    if (failure) return failure
  }
  seen.delete(value)
  return null
}

function isArrayIndexKey(key: string | symbol): boolean {
  if (typeof key === 'symbol') return false
  if (key === '') return false
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
