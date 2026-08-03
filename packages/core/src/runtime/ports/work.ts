/**
 * Discriminated runtime work payloads persisted and delivered by adapters.
 *
 * These shapes are deliberately small routing records. User payloads and flow
 * snapshots stay in the durable store; wake transports carry only enough data
 * for the kernel to find and resume the correct work item.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import type { EventCursor, FlowId, RuntimeTargetId, TaskId } from './ids'

/** Durable work the Runtime Engine can schedule, lease, and execute. */
export type RuntimeWork =
  | { readonly kind: 'flow.resume'; readonly flowId: FlowId }
  | {
      readonly kind: 'flow.timeout'
      readonly flowId: FlowId
      readonly suspendPoint: string
    }
  | {
      readonly kind: 'task.run'
      readonly taskId: TaskId
      readonly targetId: RuntimeTargetId
      /** JSON input persisted with the durable work item, never sent in wake envelopes. */
      readonly input?: JsonValue
      /**
       * Provider-neutral named-defer provenance for execution-time `defer.run`
       * evidence. Absent for ordinary `flow.defer()` / task work.
       */
      readonly defer?: JsonValue
    }
  | {
      readonly kind: 'session.turn'
      readonly sessionId: string
      readonly inputId: string
      readonly cursor: number
      readonly threadId: string
      readonly input: JsonValue
      readonly model: {
        readonly definitionId: string
        readonly fingerprint: string
      }
    }
  | {
      readonly kind: 'watch.deliver'
      readonly subscriptionId: string
      readonly cursor: EventCursor
    }
