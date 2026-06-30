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
import { executeWithRetry } from '../generation/retry'
import type { JsonObject, JsonValue, RecordStore } from '../storage'
import type { CapturedObservabilityContext } from '../observability'
import { observe } from '../observability'

// Import from decomposed modules
import type {
  WithFlowOptions,
  FlowRunOptions,
  FlowHandle,
  SuspendOptions,
  StepOptions,
  FlowResult,
  FlowSnapshot,
  FlowScope,
  ListFlowsOptions,
  FlowSummary,
} from './types'
import { FlowSuspendedError, FlowCancelledError, FlowExpiredError } from './types'
import {
  createFlowId,
  signalFlow,
  cancelFlow,
  listFlows,
  slugify,
  parseDuration,
  FLOW_KEY_PREFIX,
  SIGNAL_KEY_PREFIX,
} from './lifecycle'

// Re-export types and errors so existing `import { ... } from '../flow/scope'`
// paths continue to work without any consumer changes.
export type {
  WithFlowOptions,
  FlowRunOptions,
  FlowHandle,
  SuspendOptions,
  StepOptions,
  FlowResult,
  FlowSnapshot,
  FlowScope,
  ListFlowsOptions,
  FlowSummary,
}
export { FlowSuspendedError, FlowCancelledError, FlowExpiredError, createFlowId, signalFlow, cancelFlow, listFlows }

// ─────────────────────────────────────────────────────────────────
// withFlow
// ─────────────────────────────────────────────────────────────────

/**
 * Execute a function within a flow scope.
 *
 * Returns a `FlowResult<T>` discriminated union:
 * - `{ status: 'completed', output: T, flowId }` — flow ran to completion
 * - `{ status: 'suspended', flowId, suspendedAt }` — flow paused at a suspend point
 *
 * For resume, pass `{ resume: flowId }` in options. The flow replays
 * cached step outputs and continues from the suspend point.
 *
 * @param name — Human-readable flow name for devtools display
 * @param fn — Flow execution function, receives a `FlowScope` for step tracking
 * @param options — Optional flowId, resume, goal
 */
export async function withFlow<T, TInput = void>(
  name: string,
  fn: (flow: FlowScope<TInput>) => Promise<T> | T,
  options?: WithFlowOptions<TInput>,
): Promise<FlowResult<T>> {
  const isResume = !!options?.resume
  const flowId = options?.resume ?? options?.flowId ?? createFlowId()
  const existing = getExecutionContext()
  const parentFlowId = options?.parentFlowId ?? existing?.flowId
  const startedAt = Date.now()

  // Load snapshot for resume
  let snapshot: FlowSnapshot | null = null
  let store: RecordStore | undefined
  if (isResume) {
    store = resolveRecords()
    const raw = await store.get(`${FLOW_KEY_PREFIX}${flowId}`)
    snapshot = raw as FlowSnapshot | null
    if (!snapshot) {
      throw new Error(`No suspended flow found for flowId: ${flowId}`)
    }
    if (snapshot.observabilityContext && !observe.captureContext()) {
      return await observe.withContext(
        snapshot.observabilityContext as unknown as CapturedObservabilityContext,
        () => withFlow(name, fn, options),
      )
    }
  }

  // Completed step cache (for skip-replay on resume)
  const completedSteps: Record<string, { output: JsonValue; durationMs: number }> = snapshot?.completedSteps
    ? { ...snapshot.completedSteps }
    : {}

  // Emit flow resume hook (before flow start, so timeline ordering is correct)
  if (isResume) {
  }

  // Resolve input: on resume, restore from snapshot; otherwise use options
  const flowInput = (isResume && snapshot?.input !== undefined ? snapshot.input : options?.input) as TInput

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
  const emittedSuspensionMarkers = new Set<string>()

  // Accumulated step results — pre-populated from snapshot on resume
  const results: Record<string, unknown> = {}
  for (const [label, cached] of Object.entries(completedSteps)) {
    results[label] = cached.output
  }

  // Create the flow scope
  const scope: FlowScope<TInput> = {
    flowId,
    input: flowInput,
    results,

    async step<S>(
      label: string,
      stepFn: ((flow: FlowScope<TInput>) => Promise<S> | S) | (() => Promise<S> | S),
      stepOptions?: StepOptions,
    ): Promise<S> {
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
      const boundStepFn = () => (stepFn as (flow: FlowScope<TInput>) => Promise<S> | S)(scope)
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
          runWithExecutionContext(stepContext, () => executeWithRetry(boundStepFn, stepOptions)),
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
      // On resume, first check for expiration
      if (isResume && snapshot) {
        const timeoutAt = snapshot.timeoutAt as number | undefined
        if (timeoutAt && Date.now() > timeoutAt) {
          // Flow has expired — invoke callback and throw
          if (_options?.onExpired) {
            await _options.onExpired({ flowId, suspendedAt: _name })
          }
          throw new FlowExpiredError(_name)
        }

        // Check if signal exists
        if (store) {
          const signalKey = `${SIGNAL_KEY_PREFIX}${flowId}:${_name}`
          const signalDoc = await store.get(signalKey)
          if (signalDoc) {
            // Signal found — emit hook and return payload
            const payload = (signalDoc.payload ?? {}) as S
            return payload
          }
        }
      }

      // Verify store is available before suspending
      const flowStore = store ?? getRuntime().records
      if (!flowStore) {
        throw new Error('flow.suspend() requires a RecordStore. Configure one via config({ persistence: { records } }).')
      }

      // Not resuming or no signal yet — suspend
      throw new FlowSuspendedError(_name, _options)
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

    cancel(reason?: string): never {
      throw new FlowCancelledError(reason)
    },
  }

  // Run the flow function with flow/session metadata while the canonical
  // observability span context is active.
  try {
    const result = await flowSpan.withContext(() =>
      runWithExecutionContext({ ...existing, flowId, parentFlowId }, () => fn(scope)),
    )


    flowSpan.end({ attributes: { flowStatus: 'completed', totalSteps: stepCount } })
    return { status: 'completed', output: result, flowId }
  } catch (error) {
    // Handle suspension — persist state and return suspended result
    if (error instanceof FlowSuspendedError) {
      const flowStore = store ?? getRuntime().records
      if (flowStore) {
        const timeoutAt = error.options?.timeout ? Date.now() + parseDuration(error.options.timeout) : undefined

        const snapshotData: FlowSnapshot = {
          flowId,
          name,
          status: 'suspended',
          suspendedAt: error.suspendPoint,
          completedSteps: completedSteps as FlowSnapshot['completedSteps'],
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          observabilityContext: resumeObservabilityContext as unknown as JsonObject,
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: Date.now(),
          ...(timeoutAt !== undefined ? { timeoutAt } : {}),
          ...(options?.input !== undefined ? { input: options.input as unknown as JsonObject } : {}),
        }
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
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, {
          flowId,
          name,
          status: 'cancelled',
          suspendedAt: '',
          completedSteps: completedSteps as FlowSnapshot['completedSteps'],
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          observabilityContext: snapshot?.observabilityContext ?? (resumeObservabilityContext as unknown as JsonObject),
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: Date.now(),
          ...(error.reason !== undefined ? { cancelReason: error.reason } : {}),
          ...(flowInput !== undefined ? { input: flowInput as unknown as JsonObject } : {}),
        })
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
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, {
          ...(snapshot ?? {}),
          status: 'expired',
          updatedAt: Date.now(),
        })
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

/**
 * Define a named flow and return a frozen `FlowHandle`.
 *
 * Separates definition from execution: the handler is captured once,
 * then `.run()` can be called repeatedly with different inputs/options.
 *
 * @param name — Human-readable flow name for devtools display
 * @param handler — Flow execution function, receives a `FlowScope` for step tracking
 * @returns A frozen `FlowHandle<T, TInput>` with `.run()` and `.signal()` methods
 *
 * @example
 * ```ts
 * const researchFlow = flow('research', async (flow) => {
 *   const plan = await flow.step('plan', () => generate(planner, { model, input }))
 *   return flow.step('search', () => generate(searcher, { model, input: plan }))
 * })
 *
 * const result = await researchFlow.run()
 * ```
 */
export function flow<T, TInput = void>(
  name: string,
  handler: (flow: FlowScope<TInput>) => Promise<T> | T,
): FlowHandle<T, TInput> {
  const handle: FlowHandle<T, TInput> = {
    name,

    run(options?: FlowRunOptions<TInput>): Promise<FlowResult<T>> {
      return withFlow<T, TInput>(name, handler, {
        input: options?.input,
        flowId: options?.flowId,
        parentFlowId: options?.parentFlowId,
        goal: options?.goal,
        resume: options?.resume,
      })
    },

    signal(flowId: string, signalName: string, payload: JsonObject = {}): Promise<void> {
      return signalFlow(flowId, signalName, payload)
    },
  }

  return Object.freeze(handle)
}
