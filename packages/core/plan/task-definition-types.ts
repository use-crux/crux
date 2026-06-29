/**
 * Type helpers for keyed `task()` definitions.
 *
 * Defined task ledgers infer their task IDs and completion result payloads
 * from this module while dynamic ledgers keep accepting arbitrary string IDs.
 *
 * @module
 */

import type { z } from 'zod'
import type { JsonObject, JsonValue } from '../types/tool'

/** Runtime schema accepted by `task()` for validating completed task results. */
export type TaskResultSchema = z.ZodType<JsonValue>

/** Options for defining a task spec with `task()`. */
export interface TaskSpecOptions<TResultSchema extends TaskResultSchema | undefined = undefined> {
  /** Detailed task instructions. */
  description?: string
  /** Suggested agent/model assignment. */
  assignee?: { agent?: string; model?: string }
  /** Runtime schema for this task's completed result. */
  result?: TResultSchema
  /** Metadata copied into initial task rows when defined items are materialized. */
  metadata?: JsonObject
}

/** Pure task definition returned by `task()`. */
export interface TaskSpec<TResultSchema extends TaskResultSchema | undefined = undefined> {
  readonly label: string
  readonly description?: string
  readonly assignee?: { agent?: string; model?: string }
  readonly result?: TResultSchema
  readonly metadata?: JsonObject
}

/** Task definitions keyed by stable task IDs. */
export type TaskSpecRecord = Readonly<Record<string, TaskSpec<TaskResultSchema | undefined>>>

/** Task ID accepted by a handle: literal keys for defined mode, any string for dynamic mode. */
export type TaskId<TItems extends TaskSpecRecord | undefined = undefined> = TItems extends TaskSpecRecord
  ? Extract<keyof TItems, string>
  : string

/** Result payload for a task ID on a dynamic or defined task handle. */
export type TaskResult<
  TItems extends TaskSpecRecord | undefined,
  TTaskId extends string,
> = TItems extends TaskSpecRecord
  ? TTaskId extends keyof TItems
    ? TItems[TTaskId] extends TaskSpec<infer TResultSchema>
      ? TResultSchema extends TaskResultSchema
        ? z.infer<TResultSchema>
        : JsonValue
      : JsonValue
    : never
  : JsonValue

/** Rest-argument shape for `complete()`; schema-backed tasks require a typed result. */
export type TaskCompleteArgs<
  TItems extends TaskSpecRecord | undefined,
  TTaskId extends string,
> = TItems extends TaskSpecRecord
  ? TTaskId extends keyof TItems
    ? TItems[TTaskId] extends TaskSpec<infer TResultSchema>
      ? TResultSchema extends TaskResultSchema
        ? [result: z.infer<TResultSchema>]
        : [result?: JsonValue]
      : [result?: JsonValue]
    : never
  : [result?: JsonValue]
