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
  FlowRunOptions,
  FlowResumeOptions,
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
import { noPayload, signalSchemaFor, validateSignalPayload } from './signals'
import type { FlowDefinitionOptions, FlowSignalMap } from './signals'
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
} from './lifecycle'

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
  ListFlowsOptions,
  FlowSummary,
}
export { FlowSuspendedError, FlowCancelledError, FlowExpiredError, createFlowId, signalFlow, cancelFlow, listFlows, noPayload }

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
}

async function executeFlow<T, TInput = void, TSignals extends FlowSignalMap | undefined = undefined>(
  name: string,
  fn: (flow: FlowScope<TInput, TSignals>, input: TInput) => Promise<T> | T,
  options?: FlowExecutionOptions<TInput, TSignals>,
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
    assertFlowSnapshotResumable(snapshot)
    if (snapshot.observabilityContext && !observe.captureContext()) {
      return await observe.withContext(
        snapshot.observabilityContext as unknown as CapturedObservabilityContext,
        () => executeFlow(name, fn, options),
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
  const scope = {
    flowId,
    input: flowInput,
    results,

    async step<S>(
      label: string,
      stepFn: ((flow: FlowScope<TInput, TSignals>) => Promise<S> | S) | (() => Promise<S> | S),
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
      const localSchema = signalSchemaFor(options?.signals?.[_name])
      const suspendOptions = (localSchema ? { ..._options, schema: localSchema } : _options) as
        | SuspendOptions<S>
        | undefined
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
            const payload = validateSignalPayload(_name, suspendOptions?.schema, signalDoc.payload ?? {}) as S
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


    if (isResume && store && snapshot) {
      const completedAt = Date.now()
      await store.put(`${FLOW_KEY_PREFIX}${flowId}`, {
        ...snapshot,
        status: 'completed',
        completedSteps: completedSteps as FlowSnapshot['completedSteps'],
        updatedAt: completedAt,
        completedAt,
        observabilityContext: snapshot.observabilityContext ?? (resumeObservabilityContext as unknown as JsonObject),
      })
    }

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
          ...(flowInput !== undefined ? { input: flowInput as unknown as JsonValue } : {}),
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
        const cancelledAt = Date.now()
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, {
          flowId,
          name,
          status: 'cancelled',
          suspendedAt: '',
          completedSteps: completedSteps as FlowSnapshot['completedSteps'],
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          observabilityContext: snapshot?.observabilityContext ?? (resumeObservabilityContext as unknown as JsonObject),
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: cancelledAt,
          cancelledAt,
          ...(error.reason !== undefined ? { cancelReason: error.reason } : {}),
          ...(flowInput !== undefined ? { input: flowInput as unknown as JsonValue } : {}),
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
        const expiredAt = Date.now()
        await flowStore.put(`${FLOW_KEY_PREFIX}${flowId}`, {
          ...(snapshot ?? {}),
          status: 'expired',
          expiredAt,
          updatedAt: expiredAt,
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

  const handlerExpectsInput = handler.length >= 2
  const runtimeHandler = handler as (
    flow: FlowScope<unknown, FlowSignalMap | undefined>,
    input?: unknown,
  ) => Awaitable<unknown>
  const executeHandler = (scope: FlowScope<unknown, FlowSignalMap | undefined>, input: unknown) =>
    runtimeHandler(scope, input)

  const handle = {
    name,

    run(...args: readonly unknown[]): Promise<FlowResult<unknown>> {
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(name, executeHandler, {
        ...normalizeRunArgs(args, handlerExpectsInput),
        signals: definitionOptions?.signals,
      })
    },

    resume(flowId: string, options?: FlowResumeOptions): Promise<FlowResult<unknown>> {
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(name, executeHandler, {
        parentFlowId: options?.parentFlowId,
        goal: options?.goal,
        resume: flowId,
        signals: definitionOptions?.signals,
      })
    },

    async signal(flowId: string, signalName: string, payload: JsonValue = {}): Promise<void> {
      const parsedPayload = validateSignalPayload(signalName, definitionOptions?.signals[signalName], payload)
      await signalFlow(flowId, signalName, parsedPayload as JsonValue)
    },
  }

  return Object.freeze(handle) as FlowHandle<unknown, unknown, FlowSignalMap | undefined>
}

function isFlowDefinitionOptions(value: unknown): value is FlowDefinitionOptions<FlowSignalMap> {
  return isRecord(value) && isRecord(value.signals)
}
