/**
 * Runtime flow scope — groups `generate()` calls into structured pipelines
 * with named steps, automatic devtools tracing, and retry/fallback support.
 *
 * Supports suspend/resume for human-in-the-loop and async-wait workflows.
 * Suspended flows persist their state to a `RecordStore` and can be resumed
 * in a separate call (potentially in a different process).
 *
 * @module
 */

import { runWithExecutionContext, getExecutionContext } from '../runtime/execution-context'
import { captureSource } from '../project-index/source'
import { getRuntime, resolveRecords } from '../runtime/runtime'
import {
  createRuntime,
  type ResolvedRuntimeEngine,
} from '../runtime/api/create-runtime'
import { runtimeRequiredError } from '../runtime/api/runtime-required'
import {
  registerRuntimeTarget,
  runtimeTargetMap,
} from '../runtime/api/target-registry'
import type { RuntimeTarget, RuntimeTargetOutcome } from '../runtime/engine/kernel'
import { wakeEnvelopeForWork } from '../runtime/engine/kernel'
import {
  createReplayFingerprint,
  runtimeSignalEventName,
} from '../runtime/engine/replay'
import type { WorkItem } from '../runtime/engine/work'
import type {
  FlowId as RuntimeFlowId,
  RuntimeTargetId,
  TaskId,
} from '../runtime/ports/ids'
import type { RuntimeTaskInput, RuntimeTaskTarget } from '../runtime/api/task'
import { executeWithRetry } from '../generation/retry'
import type { JsonObject, JsonValue, RecordStore } from '../storage'
import type { CapturedObservabilityContext } from '../observability'
import { observe } from '../observability'

// Import from decomposed modules
import type {
  FlowRunOptions,
  FlowResumeOptions,
  FlowHandle,
  SuspendOptions,
  StepOptions,
  FlowResult,
  FlowSnapshot,
  FlowScope,
  FlowSignalOptions,
  ListFlowsOptions,
  FlowSummary,
  FlowWaitForEvent,
  FlowWaitForOptions,
  FlowUntilIdleOptions,
  RuntimeFlowSuspendMetadata,
} from './types'
import { FlowSuspendedError, FlowCancelledError, FlowExpiredError } from './types'
import { InvalidSignalPayloadError, isNoPayloadSignal, noPayload, signalSchemaFor, validateSignalPayload } from './signals'
import type { FlowDefinitionOptions, FlowSignalMap } from './signals'
import { flowHandlerAcceptsInput } from './handler-arity'
import {
  createFlowId,
  signalFlow,
  cancelFlow,
  listFlows,
  slugify,
  parseDuration,
  FLOW_KEY_PREFIX,
  SIGNAL_KEY_PREFIX,
  assertFlowSnapshotResumable,
  consumeFlowSignal,
} from './lifecycle'
import {
  cloneDeliveredSignals,
  deliveredSignalPayload,
  deliveredSignalsForSnapshot,
  recordDeliveredSignal,
  suspendDeliveryKey,
} from './suspend-state'
import { createFlowStepIdentityTracker } from './step-identity'
import { flowStepRetryOptions } from './retry-control'
import { assertFlowJsonValue, assertFlowSnapshotMetadata, completedStepsForSnapshot } from './serialization'
import {
  completedStepsFromRuntimeSnapshot,
  createRuntimeWorkIdGenerator,
  deliveredRuntimePayloads,
  flowIdForRuntimeWork,
  runtimeCompletedSteps,
  runtimeFlowSnapshot,
  runtimeInputValue,
  runtimeSignalEventId,
  runtimeStartIdempotencyKey,
  runtimeWorkId,
  type RuntimeFlowExecution,
  type RuntimeFlowTargetRef,
} from './runtime-engine'

// Re-export types and errors so existing internal `../flow/scope` imports
// keep working while the public flow surface stays centered on `flow()`.
export type {
  FlowRunOptions,
  FlowResumeOptions,
  FlowHandle,
  SuspendOptions,
  StepOptions,
  FlowResult,
  FlowSnapshot,
  FlowScope,
  FlowSignalOptions,
  FlowUntilIdleOptions,
  FlowWaitForEvent,
  FlowWaitForOptions,
  ListFlowsOptions,
  FlowSummary,
}
export {
  FlowSuspendedError,
  FlowCancelledError,
  FlowExpiredError,
  createFlowId,
  signalFlow,
  cancelFlow,
  listFlows,
  InvalidSignalPayloadError,
  noPayload,
}
export { FlowSerializationError } from './serialization'
export type { FlowPersistenceBoundary } from './serialization'

// ─────────────────────────────────────────────────────────────────
// Internal flow executor
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a captured flow handler within a runtime flow scope.
 *
 * This is the implementation behind `flow().run()`. It is intentionally not
 * exported as an authoring API; users define flows once with `flow()` and run
 * the returned handle.
 *
 * @param name - Human-readable flow name for devtools display.
 * @param fn - Flow execution function, receiving a `FlowScope` for step tracking.
 * @param options - Runtime options supplied by the flow handle.
 */
type Awaitable<T> = T | Promise<T>

type InferredFlowHandler<TSignals extends FlowSignalMap | undefined = undefined> = (
  flow: FlowScope<unknown, TSignals>,
  ...args: never[]
) => Awaitable<unknown>

type HandlerInput<THandler> = THandler extends (...args: never[]) => Awaitable<unknown>
  ? Parameters<THandler> extends [unknown, infer TInput, ...unknown[]]
    ? TInput
    : void
  : void

type HandlerOutput<THandler> = THandler extends (...args: never[]) => Awaitable<infer TOutput>
  ? Awaited<TOutput>
  : never

interface FlowExecutionOptions<TInput, TSignals extends FlowSignalMap | undefined = undefined>
  extends FlowRunOptions, FlowResumeOptions {
  /** Input persisted for fresh runs and restored on resume. */
  input?: TInput
  /** Flow ID for a suspended flow that should be resumed. */
  resume?: string
  /** Definition-time local signal declarations. */
  signals?: TSignals
  /** Runtime Engine execution context when a flow target is running from durable work. */
  runtime?: RuntimeFlowExecution
}


async function executeFlow<T, TInput = void, TSignals extends FlowSignalMap | undefined = undefined>(
  name: string,
  fn: (flow: FlowScope<TInput, TSignals>, input: TInput) => Promise<T> | T,
  options?: FlowExecutionOptions<TInput, TSignals>,
): Promise<FlowResult<T>> {
  const runtimeExecution = options?.runtime
  const isRuntimeExecution = runtimeExecution !== undefined
  const isResume = !!options?.resume || (isRuntimeExecution && runtimeExecution.snapshot.status !== 'running')
  const flowId = runtimeExecution?.snapshot.flowId ?? options?.resume ?? options?.flowId ?? createFlowId()
  const existing = getExecutionContext()
  const parentFlowId = options?.parentFlowId ?? existing?.flowId
  const startedAt = Date.now()

  // Load snapshot for resume
  let snapshot: FlowSnapshot | null = null
  let store: RecordStore | undefined
  if (!isRuntimeExecution && isResume) {
    store = resolveRecords()
    const raw = await store.get(`${FLOW_KEY_PREFIX}${flowId}`)
    snapshot = raw as FlowSnapshot | null
    if (!snapshot) {
      throw new Error(`No suspended flow found for flowId: ${flowId}`)
    }
    assertFlowSnapshotResumable(snapshot)
    if (snapshot.observabilityContext && !observe.captureContext()) {
      return await observe.withContext(
        snapshot.observabilityContext as unknown as CapturedObservabilityContext,
        () => executeFlow(name, fn, options),
      )
    }
  }

  // Completed step cache (for skip-replay on resume)
  const completedSteps: Record<string, { output: JsonValue; durationMs: number }> = runtimeExecution
    ? completedStepsFromRuntimeSnapshot(runtimeExecution.snapshot)
    : snapshot?.completedSteps
      ? { ...snapshot.completedSteps }
      : {}
  const deliveredSignals = runtimeExecution ? {} : cloneDeliveredSignals(snapshot)

  // Resolve input: on resume, restore from snapshot; otherwise use options
  const flowInput = (
    runtimeExecution
      ? runtimeExecution.snapshot.input
      : isResume && snapshot?.input !== undefined
        ? snapshot.input
        : options?.input
  ) as TInput

  // Open the flow span: every child trace started inside the flow
  // (e.g. via @use-crux/convex/server ctx.crux.runAction) captures this spanId as
  // its parentSpanId, so the trace tree shows
  // `flow > runtime-flow:start > <child agent>` instead of orphaning
  // the child under the parent's trace boundary.
  const flowSpan = observe.openSpan({
    name,
    family: 'flow',
    primitive: 'flow.run',
    attributes: {
      flowId,
      parentFlowId: parentFlowId ?? null,
      goal: options?.goal ?? null,
      resume: isResume,
    },
  })
  const resumeObservabilityContext =
    observe.captureContext() ??
    ({
      runId: flowSpan.runId,
      traceId: flowSpan.traceId,
      spanStack: flowSpan.parentSpanId ? [flowSpan.parentSpanId] : [],
    } as const)
  const spanId = flowSpan.spanId

  // Track aggregates across steps
  let stepCount = 0
  let suspendCount = 0
  let durableEffectCount = 0
  const emittedSuspensionMarkers = new Set<string>()

  // Accumulated step results — pre-populated from snapshot on resume
  const results: Record<string, unknown> = {}
  for (const [label, cached] of Object.entries(completedSteps)) {
    results[label] = cached.output
  }
  const stepIdentities = createFlowStepIdentityTracker()

  // Create the flow scope
  const scope = {
    flowId,
    input: flowInput,
    results,

    async step<S>(
      label: string,
      stepFn: ((flow: FlowScope<TInput, TSignals>) => Promise<S> | S) | (() => Promise<S> | S),
      stepOptions?: StepOptions,
    ): Promise<S> {
      runtimeExecution?.fingerprint.observe(`step:${label}`)
      stepIdentities.use(label)
      stepCount++
      const stepId = `${slugify(label)}-${stepCount}`

      // Skip-replay: return cached output if available
      if (completedSteps[label]) {
        const cached = completedSteps[label].output as S
        results[label] = cached
        return cached
      }

      const stepContext = {
        ...getExecutionContext(),
        flowId,
        stepId,
        stepLabel: label,
      }
      const stepStartedAt = Date.now()

      // Capture source location and emit step start hook
      const stepSource = captureSource()

      // Always pass scope to step function — () => T functions ignore the extra arg
      const boundStepFn = () => (stepFn as (flow: FlowScope<TInput, TSignals>) => Promise<S> | S)(scope)
      const stepSpan = observe.openSpan({
        name: label,
        family: 'flow',
        primitive: 'flow.step',
        attributes: {
          flowId,
          stepId,
          stepLabel: label,
        },
      })
      const wrappedFn = () =>
        stepSpan.withContext(() =>
          runWithExecutionContext(stepContext, () => executeWithRetry(boundStepFn, flowStepRetryOptions(stepOptions))),
        )

      try {
        const result = await wrappedFn()

        // Record the step output on the trace: the span model is the source
        // of truth for step signals (quality ctx.step(), devtools detail).
        if (result !== undefined) {
          stepSpan.withContext(() => {
            observe.artifact({
              kind: 'output',
              contentType: 'application/json',
              encoding: 'json',
              preview: result,
              attributes: { flowId, stepId, stepLabel: label },
            })
          })
        }

        // Cache the step output for potential suspend serialization
        completedSteps[label] = {
          output: result as JsonValue,
          durationMs: Date.now() - stepStartedAt,
        }

        // Populate the results accumulator
        results[label] = result

        // Emit step end hook
        stepSpan.end()

        return result
      } catch (error) {
        // Don't emit step end for FlowSuspendedError — it's not a real step error
        if (!(error instanceof FlowSuspendedError)) {
          stepSpan.error(error)
        } else {
          await stepSpan.withContext(async () => {
            await emitFlowSuspensionMarker(error.suspendPoint, {
              flowId,
              stepId,
              stepLabel: label,
              timeout: error.options?.timeout,
              emittedSuspensionMarkers,
            })
          })
          stepSpan.end({ status: 'suspended' })
        }
        throw error
      }
    },

    async suspend<S>(_name: string, _options?: SuspendOptions<S>): Promise<S> {
      suspendCount++
      const deliveryKey = suspendDeliveryKey(suspendCount, _name)
      runtimeExecution?.fingerprint.observe(`suspend:${_name}`)
      const localSignalSpec = options?.signals?.[_name]
      const localSchema = signalSchemaFor(localSignalSpec)
      const suspendOptions = (localSchema ? { ..._options, schema: localSchema } : _options) as
        | SuspendOptions<S>
        | undefined
      const payloadSpec = localSignalSpec ?? suspendOptions?.schema
      const replayPayload =
        runtimeExecution?.deliveredPayloads.get(_name) ?? deliveredSignalPayload(deliveredSignals, deliveryKey)
      if (isResume && replayPayload !== undefined) {
        return validateSignalPayload(_name, payloadSpec, replayPayload) as S
      }

      // On resume, first check for expiration
      if (isResume && snapshot) {
        const timeoutAt = snapshot.timeoutAt as number | undefined
        if (timeoutAt && Date.now() > timeoutAt) {
          // Flow has expired — invoke callback and throw
          if (suspendOptions?.onExpired) {
            await suspendOptions.onExpired({ flowId, suspendedAt: _name })
          }
          throw new FlowExpiredError(_name)
        }

        // Check if signal exists
        if (store) {
          const signalKey = `${SIGNAL_KEY_PREFIX}${flowId}:${_name}`
          const signalDoc = await store.get(signalKey)
          if (signalDoc) {
            // Signal found — emit hook and return payload
            const rawPayload = 'payload' in signalDoc ? signalDoc.payload : {}
            const payload = validateSignalPayload(_name, payloadSpec, rawPayload) as S
            assertFlowJsonValue(payload, { boundary: 'signal payload' })
            recordDeliveredSignal(deliveredSignals, deliveryKey, _name, payload as JsonValue)
            await consumeFlowSignal(store, flowId, _name)
            return payload
          }
        }
      }

      if (runtimeExecution) {
        throw new FlowSuspendedError(_name, suspendOptions)
      }

      // Verify store is available before suspending
      const flowStore = store ?? getRuntime().records
      if (!flowStore) {
        throw new Error('flow.suspend() requires a RecordStore. Configure one via config({ persistence: { records } }).')
      }

      // Not resuming or no signal yet — suspend
      throw new FlowSuspendedError(_name, suspendOptions)
    },

    async waitUntil(
      _name: string,
      conditionFn: () => boolean | Promise<boolean>,
      _options?: Omit<SuspendOptions, 'schema'>,
    ): Promise<void> {
      // On resume, check expiration first
      if (isResume && snapshot) {
        const timeoutAt = snapshot.timeoutAt as number | undefined
        if (timeoutAt && Date.now() > timeoutAt) {
          if (_options?.onExpired) {
            await _options.onExpired({ flowId, suspendedAt: _name })
          }
          throw new FlowExpiredError(_name)
        }
      }

      // Evaluate the condition
      const conditionResult = await conditionFn()
      if (conditionResult) {
        // Condition met — continue execution
        return
      }

      // Condition not met — verify store and suspend
      const flowStore = store ?? getRuntime().records
      if (!flowStore) {
        throw new Error('flow.waitUntil() requires a RecordStore. Configure one via config({ persistence: { records } }).')
      }

      throw new FlowSuspendedError(_name, _options as SuspendOptions)
    },

    async waitFor<TPayload = JsonValue>(
      event: string | FlowWaitForEvent<TPayload>,
      waitOptions?: FlowWaitForOptions,
    ): Promise<TPayload> {
      const eventSpec = normalizeWaitForEvent(event)
      const suspendPoint = `waitFor:${eventSpec.name}`
      runtimeExecution?.fingerprint.observe(`waitFor:${eventSpec.name}`)
      const replayPayload = runtimeExecution?.deliveredPayloads.get(suspendPoint)
      if (isResume && replayPayload !== undefined) {
        return validateWaitForPayload(eventSpec, replayPayload)
      }

      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: 'flow.waitFor()' })
      }

      const metadata: RuntimeFlowSuspendMetadata = {
        eventName: eventSpec.name,
        match: waitOptions?.match ?? {},
        fingerprint: `waitFor:${eventSpec.name}`,
      }
      throw new FlowSuspendedError(
        suspendPoint,
        { timeout: waitOptions?.timeout },
        metadata,
      )
    },

    async defer<TTask extends RuntimeTaskTarget>(
      taskTarget: TTask,
      input: RuntimeTaskInput<TTask>,
    ): Promise<{ workId: string }> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: 'flow.defer()' })
      }
      durableEffectCount++
      runtimeExecution.fingerprint.observe(`defer:${taskTarget.name}`)
      const key = `defer:${durableEffectCount}`
      const recorded = runtimeExecution.snapshot.scheduledEffects?.[key]
      if (recorded?.workId) return { workId: recorded.workId }

      assertFlowJsonValue(input, { boundary: 'flow snapshot metadata' })
      const workId = runtimeWorkId()
      runtimeExecution.scheduledEffects.push({
        kind: 'defer',
        key,
        namespace: runtimeExecution.work.namespace,
        targetId: taskTarget.targetId,
        taskId: workId as unknown as TaskId,
        workId,
        input: input as JsonValue,
        idleScope: `flow:${flowId}`,
      })
      return { workId }
    },

    async after<TTask extends RuntimeTaskTarget>(
      taskTarget: TTask,
      delay: string,
      input: RuntimeTaskInput<TTask>,
    ): Promise<void> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: 'flow.after()' })
      }
      durableEffectCount++
      runtimeExecution.fingerprint.observe(`after:${taskTarget.name}`)
      const key = `after:${durableEffectCount}`
      if (runtimeExecution.snapshot.scheduledEffects?.[key]) return

      assertFlowJsonValue(input, { boundary: 'flow snapshot metadata' })
      runtimeExecution.scheduledEffects.push({
        kind: 'after',
        key,
        namespace: runtimeExecution.work.namespace,
        targetId: taskTarget.targetId,
        taskId: `${flowId}:${key}:${taskTarget.name}` as TaskId,
        fireAt: new Date(Date.now() + parseDuration(delay)),
        input: input as JsonValue,
        idleScope: `flow:${flowId}`,
      })
    },

    async untilIdle(options: FlowUntilIdleOptions): Promise<void> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: 'flow.untilIdle()' })
      }
      if (options.scope !== 'current-flow') {
        throw new Error('flow.untilIdle() only supports { scope: "current-flow" } in v1.')
      }
      const idleScope = `flow:${flowId}`
      const eventName = `crux.idle:${idleScope}`
      const suspendPoint = `untilIdle:${idleScope}`
      runtimeExecution.fingerprint.observe(`waitFor:${eventName}`)
      if (runtimeExecution.deliveredPayloads.has(suspendPoint)) return

      const count = await runtimeExecution.runtime.store.state.getIdleCount(
        runtimeExecution.work.namespace,
        idleScope,
      )
      const bufferedDeferCount = runtimeExecution.scheduledEffects.filter(
        (effect) => effect.kind === 'defer' && effect.idleScope === idleScope,
      ).length
      if (count === 0 && bufferedDeferCount === 0) return

      throw new FlowSuspendedError(
        suspendPoint,
        undefined,
        {
          eventName,
          match: {},
          fingerprint: `waitFor:${eventName}`,
        },
      )
    },

    cancel(reason?: string): never {
      throw new FlowCancelledError(reason)
    },
  } as FlowScope<TInput, TSignals>

  // Run the flow function with flow/session metadata while the canonical
  // observability span context is active.
  try {
    const result = await flowSpan.withContext(() =>
      runWithExecutionContext({ ...existing, flowId, parentFlowId }, () => fn(scope, flowInput)),
    )

    if (runtimeExecution) {
      runtimeExecution.fingerprint.complete()
      runtimeExecution.outcome = {
        status: 'completed',
        flowSnapshot: runtimeFlowSnapshot(runtimeExecution, {
          status: 'completed',
          input: flowInput,
          completedSteps,
          scheduledEffects: runtimeExecution.snapshot.scheduledEffects,
        }),
        scheduledEffects: runtimeExecution.scheduledEffects,
      }
      runtimeExecution.result = { status: 'completed', output: result, flowId }
    }

    if (isResume && store && snapshot) {
      const completedAt = Date.now()
      const deliveredSignalsSnapshot = deliveredSignalsForSnapshot(deliveredSignals)
      const completedSnapshot: FlowSnapshot = {
        ...snapshot,
        status: 'completed',
        completedSteps: completedStepsForSnapshot(completedSteps),
        ...(deliveredSignalsSnapshot ? { deliveredSignals: deliveredSignalsSnapshot } : {}),
        updatedAt: completedAt,
        completedAt,
        observabilityContext: snapshot.observabilityContext ?? (resumeObservabilityContext as unknown as JsonObject),
      }
      assertFlowSnapshotMetadata(completedSnapshot)
      await store.put(`${FLOW_KEY_PREFIX}${flowId}`, completedSnapshot)
    }

    flowSpan.end({ attributes: { flowStatus: 'completed', totalSteps: stepCount } })
    return { status: 'completed', output: result, flowId }
  } catch (error) {
    // Handle suspension — persist state and return suspended result
    if (error instanceof FlowSuspendedError) {
      if (runtimeExecution) {
        runtimeExecution.fingerprint.complete()
        const timeoutAt = error.options?.timeout ? new Date(Date.now() + parseDuration(error.options.timeout)) : undefined
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: 'flow input' })
        }
        runtimeExecution.outcome = {
          status: 'suspended',
          suspension: {
            namespace: runtimeExecution.work.namespace,
            workId: runtimeExecution.work.workId,
            flowId: flowId as RuntimeFlowId,
            targetId: runtimeExecution.work.targetId,
            snapshot: {
              input: runtimeInputValue(flowInput),
              completedSteps: runtimeCompletedSteps(completedSteps),
              fingerprint: runtimeExecution.fingerprint.observed,
              scheduledEffects: runtimeExecution.snapshot.scheduledEffects,
            },
            suspends: [
              {
                label: error.suspendPoint,
                eventName:
                  error.runtime?.eventName ??
                  runtimeSignalEventName(flowId, error.suspendPoint),
                match: error.runtime?.match ?? {},
                timeoutAt,
              },
            ],
            scheduledEffects: runtimeExecution.scheduledEffects,
          },
        }
        runtimeExecution.result = { status: 'suspended', flowId, suspendedAt: error.suspendPoint }

        await flowSpan.withContext(async () => {
          await emitFlowSuspensionMarker(error.suspendPoint, {
            flowId,
            timeout: error.options?.timeout,
            emittedSuspensionMarkers,
          })
        })

        flowSpan.end({
          status: 'suspended',
          attributes: { suspendedAt: error.suspendPoint, totalSteps: stepCount },
        })
        return runtimeExecution.result as FlowResult<T>
      }

      const flowStore = store ?? getRuntime().records
      if (flowStore) {
        const timeoutAt = error.options?.timeout ? Date.now() + parseDuration(error.options.timeout) : undefined
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: 'flow input' })
        }

        const deliveredSignalsSnapshot = deliveredSignalsForSnapshot(deliveredSignals)
        const snapshotData: FlowSnapshot = {
          flowId,
          name,
          status: 'suspended',
          suspendedAt: error.suspendPoint,
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot ? { deliveredSignals: deliveredSignalsSnapshot } : {}),
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          observabilityContext: resumeObservabilityContext as unknown as JsonObject,
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: Date.now(),
          ...(timeoutAt !== undefined ? { timeoutAt } : {}),
          ...(flowInput !== undefined ? { input: flowInput as unknown as JsonValue } : {}),
        }
        assertFlowSnapshotMetadata(snapshotData)
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, snapshotData)
      }

      await flowSpan.withContext(async () => {
        await emitFlowSuspensionMarker(error.suspendPoint, {
          flowId,
          timeout: error.options?.timeout,
          emittedSuspensionMarkers,
        })
      })

      flowSpan.end({
        status: 'suspended',
        attributes: { suspendedAt: error.suspendPoint, totalSteps: stepCount },
      })
      return { status: 'suspended', flowId, suspendedAt: error.suspendPoint }
    }

    // Handle cancellation
    if (error instanceof FlowCancelledError) {
      const flowStore = store ?? getRuntime().records
      if (flowStore) {
        const cancelledAt = Date.now()
        if (error.reason !== undefined) {
          assertFlowJsonValue(error.reason, { boundary: 'flow snapshot metadata', path: '$.cancelReason' })
        }
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: 'flow input' })
        }
        const deliveredSignalsSnapshot = deliveredSignalsForSnapshot(deliveredSignals)
        const snapshotData: FlowSnapshot = {
          flowId,
          name,
          status: 'cancelled',
          suspendedAt: '',
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot ? { deliveredSignals: deliveredSignalsSnapshot } : {}),
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          observabilityContext: snapshot?.observabilityContext ?? (resumeObservabilityContext as unknown as JsonObject),
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: cancelledAt,
          cancelledAt,
          ...(error.reason !== undefined ? { cancelReason: error.reason } : {}),
          ...(flowInput !== undefined ? { input: flowInput as unknown as JsonValue } : {}),
        }
        assertFlowSnapshotMetadata(snapshotData)
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, snapshotData)
      }

      flowSpan.end({
        status: 'cancelled',
        attributes: { cancelReason: error.reason ?? null, totalSteps: stepCount },
      })
      return { status: 'cancelled', flowId, cancelReason: error.reason }
    }

    // Handle expiration
    if (error instanceof FlowExpiredError) {
      const flowStore = store ?? getRuntime().records
      if (flowStore) {
        const expiredAt = Date.now()
        const deliveredSignalsSnapshot = deliveredSignalsForSnapshot(deliveredSignals)
        const snapshotData = {
          ...(snapshot ?? {}),
          status: 'expired',
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot ? { deliveredSignals: deliveredSignalsSnapshot } : {}),
          expiredAt,
          updatedAt: expiredAt,
        } as FlowSnapshot
        assertFlowSnapshotMetadata(snapshotData)
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, snapshotData)
      }

      flowSpan.error(error, { flowStatus: 'expired', suspendedAt: error.suspendPoint, totalSteps: stepCount })
      return { status: 'expired', flowId, suspendedAt: error.suspendPoint }
    }

    flowSpan.error(error, { totalSteps: stepCount })
    throw error
  }
}

function flowTraceContext(sessionId: string | undefined, parentFlowId: string | undefined): JsonObject {
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(parentFlowId !== undefined ? { parentFlowId } : {}),
  }
}

async function emitFlowSuspensionMarker(
  suspendPoint: string,
  options: {
    flowId: string
    stepId?: string
    stepLabel?: string
    timeout?: string
    emittedSuspensionMarkers: Set<string>
  },
): Promise<void> {
  const markerKey = `${options.stepId ?? 'flow'}:${suspendPoint}`
  if (options.emittedSuspensionMarkers.has(markerKey)) return
  options.emittedSuspensionMarkers.add(markerKey)

  const marker = observe.openSpan({
    name: suspendPoint,
    family: 'flow',
    primitive: 'flow.suspension',
    attributes: {
      flowId: options.flowId,
      suspendPoint,
      ...(options.stepId ? { causedByStepId: options.stepId } : {}),
      ...(options.stepLabel ? { causedByStepLabel: options.stepLabel } : {}),
      ...(options.timeout ? { timeout: options.timeout } : {}),
    },
    implicitRun: false,
  })
  marker.end({ status: 'suspended' })
}

// ─────────────────────────────────────────────────────────────────
// flow — definition-time factory
// ─────────────────────────────────────────────────────────────────

function normalizeRunArgs(args: readonly unknown[], handlerExpectsInput: boolean): FlowExecutionOptions<unknown> {
  if (handlerExpectsInput) {
    return {
      input: args[0],
      ...(args[1] as FlowRunOptions | undefined),
    }
  }

  if (args.length === 0) {
    return {}
  }

  const first = args[0]
  if (isRunOptionsLike(first)) {
    return first
  }

  return {
    input: first,
    ...(args[1] as FlowRunOptions | undefined),
  }
}

function isRunOptionsLike(value: unknown): value is FlowRunOptions {
  return isRecord(value) && ('flowId' in value || 'parentFlowId' in value || 'goal' in value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeWaitForEvent<TPayload>(
  event: string | FlowWaitForEvent<TPayload>,
): FlowWaitForEvent<TPayload> {
  return typeof event === 'string' ? { name: event } : event
}

function validateWaitForPayload<TPayload>(
  event: FlowWaitForEvent<TPayload>,
  payload: JsonValue,
): TPayload {
  if (!event.schema) return payload as TPayload
  return event.schema.parse(payload)
}

/**
 * Define a named flow and return a frozen `FlowHandle`.
 *
 * Separates definition from execution: the handler is captured once, then
 * `.run()` can be called repeatedly. Input-bearing flows infer input from the
 * handler's second parameter and expose `run(input, options?)`; no-input flows
 * expose `run(options?)`. Use `.resume(flowId, options?)` to continue a
 * suspended flow with its persisted input.
 *
 * @param name - Human-readable flow name for devtools display.
 * @param handler - Flow execution function, receiving a `FlowScope` and optional input.
 * @returns A frozen `FlowHandle` with `.run()`, `.resume()`, and `.signal()` methods.
 *
 * @example
 * ```ts
 * const reviewFlow = flow('review', async (flow, input: { docId: string }) => {
 *   const draft = await flow.step('load', () => loadDraft(input.docId))
 *   return flow.step('publish', () => publishDraft(draft))
 * })
 *
 * const suspended = await reviewFlow.run({ docId: 'doc_123' })
 * const resumed = await reviewFlow.resume(suspended.flowId)
 * ```
 */
export function flow<THandler extends InferredFlowHandler>(
  name: string,
  handler: THandler,
): FlowHandle<HandlerOutput<THandler>, HandlerInput<THandler>>
export function flow<const TSignals extends FlowSignalMap, THandler extends InferredFlowHandler<TSignals>>(
  name: string,
  options: FlowDefinitionOptions<TSignals>,
  handler: THandler,
): FlowHandle<HandlerOutput<THandler>, HandlerInput<THandler>, TSignals>
export function flow(
  name: string,
  optionsOrHandler:
    | FlowDefinitionOptions<FlowSignalMap>
    | ((flow: FlowScope<unknown, FlowSignalMap | undefined>, input?: unknown) => Awaitable<unknown>),
  maybeHandler?: (flow: FlowScope<unknown, FlowSignalMap>, input?: unknown) => Awaitable<unknown>,
): FlowHandle<unknown, unknown, FlowSignalMap | undefined> {
  const definitionOptions = isFlowDefinitionOptions(optionsOrHandler) ? optionsOrHandler : undefined
  const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler
  if (typeof handler !== 'function') {
    throw new TypeError('flow() requires a handler function.')
  }

  const handlerExpectsInput = flowHandlerAcceptsInput(handler)
  const runtimeHandler = handler as (
    flow: FlowScope<unknown, FlowSignalMap | undefined>,
    input?: unknown,
  ) => Awaitable<unknown>
  const executeHandler = (scope: FlowScope<unknown, FlowSignalMap | undefined>, input: unknown) =>
    runtimeHandler(scope, input)

  const createRuntimeTarget = (runtimeRef: RuntimeFlowTargetRef): RuntimeTarget => ({
    targetId: name as RuntimeTargetId,
    kind: 'flow' as const,
    async execute({ work }): Promise<RuntimeTargetOutcome> {
      const runtime = runtimeRef.current
      if (!runtime) {
        return {
          status: 'blocked',
          error: {
            code: 'TARGET_NOT_FOUND',
            message: `Runtime target \`${name}\` was invoked before its runtime was resolved.`,
            at: new Date(),
          },
        }
      }
      const runtimeFlowId = flowIdForRuntimeWork(work)
      const runtimeSnapshot = await runtime.store.state.getSnapshot(runtimeFlowId, {
        namespace: work.namespace,
      })
      if (!runtimeSnapshot) {
        return {
          status: 'blocked',
          error: {
            code: 'TARGET_NOT_FOUND',
            message: `Runtime flow snapshot \`${runtimeFlowId}\` could not be found.`,
            at: new Date(),
          },
        }
      }
      const runtimeExecution: RuntimeFlowExecution = {
        runtime,
        work,
        snapshot: runtimeSnapshot,
        fingerprint: createReplayFingerprint({
          recorded: runtimeSnapshot.status === 'running' ? [] : runtimeSnapshot.fingerprint,
        }),
        deliveredPayloads: await deliveredRuntimePayloads(runtime, runtimeSnapshot),
        scheduledEffects: [],
      }
      await executeFlow<unknown, unknown, FlowSignalMap | undefined>(name, executeHandler, {
        runtime: runtimeExecution,
        signals: definitionOptions?.signals,
      })
      runtimeRef.result = runtimeExecution.result
      return runtimeExecution.outcome ?? { status: 'completed' }
    },
  })

  async function withRuntime<T>(
    useRuntime: (runtime: ResolvedRuntimeEngine, runtimeRef: RuntimeFlowTargetRef) => Promise<T>,
  ): Promise<T> {
    const runtimeDefinition = getRuntime().runtimeEngine
    if (!runtimeDefinition) {
      throw new Error('No Crux runtime engine is configured.')
    }
    const runtimeRef: RuntimeFlowTargetRef = {}
    const runtime = createRuntime({
      runtime: runtimeDefinition,
        targets: runtimeTargetMap(runtimeRef),
      newWorkId: createRuntimeWorkIdGenerator(),
      startMaintenance: false,
    })
    runtimeRef.current = runtime
    try {
      return await useRuntime(runtime, runtimeRef)
    } finally {
      runtime.dispose()
    }
  }

  async function runWithRuntime(
    runOptions: FlowExecutionOptions<unknown, FlowSignalMap | undefined>,
  ): Promise<FlowResult<unknown>> {
    return await withRuntime(async (runtime, runtimeRef) => {
      const flowId = (runOptions.flowId ?? createFlowId()) as RuntimeFlowId
      const workId = runtimeWorkId()
      const input = runtimeInputValue(runOptions.input)
      const work = await runtime.store.transact(async (tx) => {
        const created = await tx.state.createWork({
          workId,
          namespace: runtime.namespace,
          work: { kind: 'flow.resume', flowId },
          targetId: name as RuntimeTargetId,
          idempotencyKey: runtimeStartIdempotencyKey(workId),
          now: new Date(),
        })
        await tx.state.putSnapshot({
          flowId,
          workId,
          targetId: name as RuntimeTargetId,
          namespace: runtime.namespace,
          status: 'running',
          input,
          completedSteps: {},
          fingerprint: [],
          pendingSuspends: [],
          scheduledEffects: {},
          updatedAt: new Date(),
        })
        return created
      })

      await runtime.kernel.handleWake(wakeEnvelopeForWork(work))
      return (runtimeRef.result as FlowResult<unknown> | undefined) ?? { status: 'suspended', flowId, suspendedAt: '' }
    })
  }

  async function resumeWithRuntime(flowId: string): Promise<FlowResult<unknown>> {
    return await withRuntime(async (runtime, runtimeRef) => {
      const snapshot = await runtime.store.state.getSnapshot(flowId as RuntimeFlowId, {
        namespace: runtime.namespace,
      })
      if (!snapshot) {
        throw new Error(`No runtime-backed flow found for flowId: ${flowId}`)
      }
      const current = await runtime.store.state.getWork(snapshot.workId, {
        namespace: runtime.namespace,
      })
      if (!current) {
        throw new Error(`No runtime work found for flowId: ${flowId}`)
      }
      const idempotencyKey = `resume:${snapshot.workId}:manual:${runtimeSignalEventId(flowId, 'resume')}`
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
      return (runtimeRef.result as FlowResult<unknown> | undefined) ?? { status: 'suspended', flowId, suspendedAt: '' }
    })
  }

  async function signalWithRuntime(
    flowId: string,
    signalName: string,
    payload: JsonValue,
    options?: FlowSignalOptions,
  ): Promise<void> {
    await withRuntime(async (runtime) => {
      await runtime.kernel.emitEvent({
        namespace: runtime.namespace,
        name: runtimeSignalEventName(flowId, signalName),
        payload,
        eventId: runtimeSignalEventId(flowId, signalName),
      })
      if (options?.resume !== false) {
        await runtime.dispatcher.nudge()
      }
    })
  }

  registerRuntimeTarget(name, createRuntimeTarget)

  const handle = {
    name,

    run(...args: readonly unknown[]): Promise<FlowResult<unknown>> {
      const runOptions = normalizeRunArgs(args, handlerExpectsInput)
      if (getRuntime().runtimeEngine) {
        return runWithRuntime({
          ...runOptions,
          signals: definitionOptions?.signals,
        })
      }
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(
        name,
        executeHandler,
        {
          ...runOptions,
          signals: definitionOptions?.signals,
        },
      )
    },

    resume(flowId: string, options?: FlowResumeOptions): Promise<FlowResult<unknown>> {
      if (getRuntime().runtimeEngine) {
        return resumeWithRuntime(flowId)
      }
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(name, executeHandler, {
        parentFlowId: options?.parentFlowId,
        goal: options?.goal,
        resume: flowId,
        signals: definitionOptions?.signals,
      })
    },

    async signal(
      flowId: string,
      signalName: string,
      payload: JsonValue | FlowSignalOptions = {},
      options?: FlowSignalOptions,
    ): Promise<void> {
      const signalSpec = definitionOptions?.signals[signalName]
      const payloadIsOptions = isNoPayloadSignal(signalSpec) && isFlowSignalOptions(payload)
      const signalOptions = payloadIsOptions && options === undefined ? payload : options
      const signalPayload = payloadIsOptions ? {} : payload
      const parsedPayload = validateSignalPayload(signalName, signalSpec, signalPayload)
      if (getRuntime().runtimeEngine) {
        await signalWithRuntime(flowId, signalName, parsedPayload as JsonValue, signalOptions)
        return
      }
      await signalFlow(flowId, signalName, parsedPayload as JsonValue)
    },
  }

  return Object.freeze(handle) as FlowHandle<unknown, unknown, FlowSignalMap | undefined>
}

function isFlowDefinitionOptions(value: unknown): value is FlowDefinitionOptions<FlowSignalMap> {
  return isRecord(value) && isRecord(value.signals)
}

function isFlowSignalOptions(value: unknown): value is FlowSignalOptions {
  return isRecord(value) && typeof value.resume === 'boolean'
}
