/**
 * Typed diagnostics for public runtime-backed flow controls.
 *
 * @module
 */

import { createRuntimeError } from '../engine/errors'
import type { WorkStatus } from '../engine/work'
import type { FlowSnapshot } from '../ports/state'

/** Create a `TARGET_NOT_FOUND` diagnostic for an unknown flow id. */
export function runtimeFlowNotFoundError(input: {
  readonly api: string
  readonly flowId: string
}): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `${input.api} could not find runtime-backed flow \`${input.flowId}\`.`,
    why: 'No durable runtime snapshot exists for that flow id in the configured namespace.',
    whatStillWorks:
      'Other runtime-backed flows in the same namespace can still be signalled, resumed, cancelled, or inspected.',
    nextStep:
      'Check the flow id and namespace, then use `crux runtime status` or `crux runtime inspect <workId>` to inspect durable work.',
  })
}

/** Create a `TARGET_NOT_FOUND` diagnostic for a mismatched flow target. */
export function runtimeFlowTargetMismatchError(input: {
  readonly api: string
  readonly flowId: string
  readonly expected: string
  readonly actual: string
}): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `${input.api} could not operate on flow \`${input.flowId}\` through target \`${input.actual}\`.`,
    why: `The durable snapshot belongs to target \`${input.expected}\`.`,
    whatStillWorks:
      'The flow can still be operated through the target recorded in its durable snapshot.',
    nextStep: `Call the API with target \`${input.expected}\`, or inspect the flow before retrying.`,
  })
}

/** Create a `TARGET_NOT_FOUND` diagnostic for a snapshot without work. */
export function runtimeFlowWorkNotFoundError(input: {
  readonly api: string
  readonly flowId: string
}): ReturnType<typeof createRuntimeError> {
  return createRuntimeError({
    code: 'TARGET_NOT_FOUND',
    whatFailed: `${input.api} could not find durable work for flow \`${input.flowId}\`.`,
    why: 'The runtime snapshot references a work item that is missing from the configured store.',
    whatStillWorks:
      'Other runtime-backed flows with matching snapshots and work items can continue.',
    nextStep:
      'Inspect the runtime store for the missing work id, then recreate or cancel the affected flow from operator tooling.',
  })
}

/** Create a typed diagnostic for flow work that cannot be manually resumed. */
export function runtimeFlowNotResumableError(input: {
  readonly api: string
  readonly flowId: string
  readonly status: WorkStatus | FlowSnapshot['status']
  readonly subject?: 'work' | 'flow snapshot'
}): ReturnType<typeof createRuntimeError> {
  const subject = input.subject ?? 'work'
  const deadLettered = subject === 'work' && input.status === 'dead-letter'
  return createRuntimeError({
    code: deadLettered ? 'WORK_DEAD_LETTERED' : 'TARGET_NOT_FOUND',
    whatFailed: `${input.api} could not resume flow \`${input.flowId}\`.`,
    why: `The durable ${subject} is ${input.status}, not suspended.`,
    whatStillWorks:
      'Suspended flow work can still be resumed; blocked or dead-lettered work can be inspected from runtime tooling.',
    nextStep: deadLettered
      ? 'Inspect the dead-lettered work, fix the cause, then run `crux runtime retry <workId>`.'
      : 'Inspect the work status and only resume flows whose durable work is suspended.',
  })
}
