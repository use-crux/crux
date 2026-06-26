/**
 * Wire format types for Crux data parts in AI SDK streams.
 *
 * A single `data-crux` part type carries all plan/task/tasklist updates.
 * The `entity` field discriminates the payload type.
 *
 * @module
 */

import type { JsonObject } from '@use-crux/core/store'

/**
 * A Crux data part payload sent through an AI SDK stream.
 *
 * Written by the server via `createCruxStreamWriter()`,
 * read by the client via `createStreamTransport().ingest()`.
 */
export interface CruxDataPart {
  /** The entity type being updated (built-in: 'plan' | 'tasklist' | 'task', extensible). */
  entity: string
  /** The CruxStore key (e.g., 'plan:abc', 'task:list-1:t1'). */
  key: string
  /** The entity value. `null` for delete events. */
  value: JsonObject | null
  /** Whether this is a set (create/update) or delete event. */
  event: 'set' | 'delete'
}

/**
 * The shape of a `data-crux` chunk in the AI SDK stream.
 * Use this as the type argument for `UIMessage` data types.
 *
 * @example
 * ```ts
 * type MyMessage = UIMessage<never, { crux: CruxDataPart }>
 * ```
 */
export interface CruxStreamChunk {
  type: 'data-crux'
  data: CruxDataPart
}
