/**
 * Discriminated runtime work payloads persisted and delivered by adapters.
 *
 * These shapes are deliberately small routing records. User payloads and flow
 * snapshots stay in the durable store; wake transports carry only enough data
 * for the kernel to find and resume the correct work item.
 *
 * @module
 */

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
    }
  | {
      readonly kind: 'watch.deliver'
      readonly subscriptionId: string
      readonly cursor: EventCursor
    }
