/**
 * Name-bound Runtime Engine flow controls.
 *
 * These APIs are exposed on the object returned by `config()`. They are
 * runtime-bound because Crux must resolve durable target names, load runtime
 * snapshots, append events, and wake work without a local flow handle.
 *
 * @module
 */

import type { JsonValue } from '../../storage'
import { getRuntime } from '../runtime'
import { createRuntime, type ResolvedRuntimeEngine } from './create-runtime'
import { runtimeRequiredError } from './runtime-required'
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from './target-registry'
import { wakeEnvelopeForWork } from '../engine/kernel'
import { runtimeSignalEventName } from '../engine/replay'
import type { FlowId, RuntimeTargetId } from '../ports/ids'
import type { CancelWorkResult } from '../engine/kernel'

/** Name-bound flow controls exposed by `config({ runtime })`. */
export interface CruxFlowRuntimeControls {
  /**
   * Send a signal to a runtime-backed flow by target name.
   *
   * The signal is appended as a reserved Runtime Engine event and matching
   * suspended work is woken idempotently. Use object-bound
   * `reviewFlow.signal(...)` when you already have the flow handle.
   */
  signal(
    targetName: string,
    flowId: string,
    signalName: string,
    payload?: JsonValue,
  ): Promise<void>

  /**
   * Resume a runtime-backed flow by target name.
   *
   * This is the name-bound form of `reviewFlow.resume(flowId)`. It requires a
   * configured runtime and a registered/generated target for `targetName`.
   */
  resume(targetName: string, flowId: string): Promise<unknown>

  /**
   * Cancel runtime-backed flow work by target name.
   *
   * Cancellation is durable and idempotent. It does not cancel independent
   * children created by `flow.defer()` or `flow.after()`.
   */
  cancel(targetName: string, flowId: string): Promise<CancelWorkResult>
}

/** Create the `crux.flows` facade for a configured Crux instance. */
export function createCruxFlowRuntimeControls(): CruxFlowRuntimeControls {
  return Object.freeze({
    signal: (
      targetName: string,
      flowId: string,
      signalName: string,
      payload: JsonValue = {},
    ) =>
      withRuntime('crux.flows.signal()', async ({ runtime }) => {
        void targetName
        await runtime.kernel.emitEvent({
          namespace: runtime.namespace,
          name: runtimeSignalEventName(flowId, signalName),
          payload,
        })
        await runtime.dispatcher.nudge()
      }),

    resume: (targetName: string, flowId: string) =>
      withRuntime('crux.flows.resume()', async ({ runtime, runtimeRef }) => {
        const snapshot = await runtime.store.state.getSnapshot(flowId as FlowId, {
          namespace: runtime.namespace,
        })
        if (!snapshot) {
          throw new Error(`No runtime-backed flow found for flowId: ${flowId}`)
        }
        if (snapshot.targetId !== (targetName as RuntimeTargetId)) {
          throw new Error(
            `Runtime flow ${flowId} belongs to target \`${snapshot.targetId}\`, not \`${targetName}\`.`,
          )
        }

        const current = await runtime.store.state.getWork(snapshot.workId, {
          namespace: runtime.namespace,
        })
        if (!current) {
          throw new Error(`No runtime work found for flowId: ${flowId}`)
        }

        const idempotencyKey = `resume:${snapshot.workId}:manual:${Date.now().toString(36)}`
        const wakeWork =
          current.status === 'suspended'
            ? await runtime.store.state.setWorkPending(snapshot.workId, {
                namespace: runtime.namespace,
                work: { kind: 'flow.resume', flowId: snapshot.flowId },
                idempotencyKey,
              })
            : current
        if (!wakeWork) {
          throw new Error(`Flow ${flowId} is ${current.status} and cannot be resumed.`)
        }

        await runtime.kernel.handleWake({
          ...wakeEnvelopeForWork(wakeWork),
          idempotencyKey:
            current.status === 'suspended' ? idempotencyKey : wakeWork.idempotencyKey,
        })
        return runtimeRef.result
      }),

    cancel: (targetName: string, flowId: string) =>
      withRuntime('crux.flows.cancel()', async ({ runtime }) => {
        const snapshot = await runtime.store.state.getSnapshot(flowId as FlowId, {
          namespace: runtime.namespace,
        })
        if (!snapshot) {
          throw new Error(`No runtime-backed flow found for flowId: ${flowId}`)
        }
        if (snapshot.targetId !== (targetName as RuntimeTargetId)) {
          throw new Error(
            `Runtime flow ${flowId} belongs to target \`${snapshot.targetId}\`, not \`${targetName}\`.`,
          )
        }
        return await runtime.kernel.cancelWork({
          namespace: runtime.namespace,
          workId: snapshot.workId,
        })
      }),
  })
}

async function withRuntime<T>(
  api: string,
  fn: (context: {
    readonly runtime: ResolvedRuntimeEngine
    readonly runtimeRef: RuntimeTargetRuntimeRef
  }) => Promise<T>,
): Promise<T> {
  const runtimeDefinition = getRuntime().runtimeEngine
  if (!runtimeDefinition) throw runtimeRequiredError({ api })

  const runtimeRef: RuntimeTargetRuntimeRef = {}
  const runtime = createRuntime({
    runtime: runtimeDefinition,
    targets: runtimeTargetMap(runtimeRef),
    startMaintenance: false,
  })
  runtimeRef.current = runtime
  try {
    return await fn({ runtime, runtimeRef })
  } finally {
    runtime.dispose()
  }
}
