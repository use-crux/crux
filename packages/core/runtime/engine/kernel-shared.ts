/**
 * Shared helpers for Runtime Engine kernel operations.
 *
 * @module
 */

import type { RuntimeTargetId } from '../ports/ids'
import type { WakeEnvelope } from './envelope'
import { createRuntimeError } from './errors'
import type { WorkItem } from './work'

/** Build the portable wake envelope for a durable work item. */
export function wakeEnvelopeForWork(work: WorkItem): WakeEnvelope {
  return {
    v: 1,
    ns: work.namespace,
    workId: work.workId,
    target: work.targetId,
    kind: work.work.kind,
    idempotencyKey: work.idempotencyKey,
    attempt: work.attempt,
  }
}

/** Return whether the work item is terminal for wake delivery. */
export function isTerminalWork(work: WorkItem): boolean {
  return (
    work.status === 'completed' ||
    work.status === 'cancelled' ||
    work.status === 'blocked' ||
    work.status === 'dead-letter'
  )
}

/** Convert an unknown thrown value into an inspectable message. */
export function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Create the typed diagnostic for a missing runtime target. */
export function targetNotFoundError(
  target: RuntimeTargetId,
): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `Runtime target \`${target}\` could not be found.`,
    why: 'The wake envelope names a target that is absent from the entry file.',
    whatStillWorks:
      'Other runtime targets in the same entry file can still run.',
    nextStep: `Export target \`${target}\` from the runtime entry file or run \`crux runtime generate\`.`,
  })
}
