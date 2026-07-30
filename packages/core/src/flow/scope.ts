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

import {
  runWithExecutionContext,
  getExecutionContext,
} from "../runtime/execution-context";
import { captureSource } from "../project-index/source";
import { getHooks, resolveRecords } from "../runtime/runtime";
import type { ResolvedRuntimeEngine } from "../runtime/api/create-runtime";
import type { RuntimeEngineDefinition } from "../runtime/api/runtime-definition";
import { createRuntimeWithHostContext } from "../runtime/api/host-context";
import {
  runtimeFlowNotFoundError,
  runtimeFlowNotResumableError,
  runtimeFlowWorkNotFoundError,
} from "../runtime/api/flow-errors";
import { cancelRuntimeFlow } from "../runtime/api/flows";
import { runtimeRequiredError } from "../runtime/api/runtime-required";
import {
  registerRuntimeTarget,
  runtimeTargetMap,
} from "../runtime/api/target-registry";
import type {
  RuntimeTarget,
  RuntimeTargetOutcome,
} from "../runtime/engine/kernel";
import { wakeEnvelopeForWork } from "../runtime/engine/kernel";
import {
  createReplayFingerprint,
  runtimeSignalEventName,
} from "../runtime/engine/replay";
import type { WorkItem } from "../runtime/engine/work";
import {
  flowManualResumeKey,
  flowStartResumeKey,
} from "../runtime/engine/idempotency";
import type {
  FlowId as RuntimeFlowId,
  RuntimeTargetId,
  TaskId,
} from "../runtime/ports/ids";
import type { RuntimeTaskInput, RuntimeTaskTarget } from "../runtime/api/task";
import { executeWithRetry } from "../generation/retry";
import type { JsonObject, JsonValue, RecordStore } from "../storage";
import {
  observe,
  sanitizePropagationCarrier,
  type OpenObservedSpan,
} from "../observability";
import {
  flowDefinitionRef,
  flowStepDefinitionRef,
} from "../observability/definition-ref";
import { runWithDeferReplayGuard } from "../defer/internal/replay-guard";
import { runScope } from "../scope/kernel";

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
} from "./types";
import {
  FlowSuspendedError,
  FlowCancelledError,
  FlowExpiredError,
} from "./types";
import {
  InvalidSignalPayloadError,
  isNoPayloadSignal,
  noPayload,
  signalSchemaFor,
  validateSignalPayload,
} from "./signals";
import type { FlowDefinitionOptions, FlowSignalMap } from "./signals";
import { flowHandlerAcceptsInput } from "./handler-arity";
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
} from "./lifecycle";
import {
  cloneDeliveredSignals,
  deliveredSignalPayload,
  deliveredSignalsForSnapshot,
  recordDeliveredSignal,
  suspendDeliveryKey,
} from "./suspend-state";
import { createFlowStepIdentityTracker } from "./step-identity";
import { flowStepRetryOptions } from "./retry-control";
import {
  assertFlowJsonValue,
  completedStepsForSnapshot,
  flowSnapshotForPersistence,
  flowValueForPersistence,
} from "./serialization";
import {
  completedStepsFromRuntimeSnapshot,
  createRuntimeWorkIdGenerator,
  deliveredRuntimePayloads,
  flowIdForRuntimeWork,
  runtimeCompletedSteps,
  runtimeDeliveredSuspendsForPersistence,
  runtimeFlowSnapshot,
  runtimeInputValue,
  runtimeResumeWork,
  runtimeScheduledWorkInput,
  runtimeSignalEventId,
  runtimeTimeoutMatches,
  runtimeWorkId,
  type RuntimeFlowExecution,
  type RuntimeFlowTargetRef,
} from "./runtime-engine";
import {
  cancelledFlowResultPayload,
  completedFlowResultPayload,
  expiredFlowResultPayload,
  finalizeFlowResult,
  flowResultOperation,
  suspendedFlowResultPayload,
} from "./result";

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
};
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
};
export { FlowSerializationError } from "./serialization";
export type { FlowPersistenceBoundary } from "./serialization";

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
type Awaitable<T> = T | Promise<T>;

type InferredFlowHandler<
  TSignals extends FlowSignalMap | undefined = undefined,
> = (
  flow: FlowScope<unknown, TSignals>,
  ...args: never[]
) => Awaitable<unknown>;

type HandlerInput<THandler> = THandler extends (
  ...args: never[]
) => Awaitable<unknown>
  ? Parameters<THandler> extends [unknown, infer TInput, ...unknown[]]
    ? TInput
    : void
  : void;

type HandlerOutput<THandler> = THandler extends (
  ...args: never[]
) => Awaitable<infer TOutput>
  ? Awaited<TOutput>
  : never;

interface FlowExecutionOptions<
  TInput,
  TSignals extends FlowSignalMap | undefined = undefined,
>
  extends FlowRunOptions, FlowResumeOptions {
  /** Input persisted for fresh runs and restored on resume. */
  input?: TInput;
  /** Flow ID for a suspended flow that should be resumed. */
  resume?: string;
  /** Definition-time local signal declarations. */
  signals?: TSignals;
  /** Runtime Engine execution context when a flow target is running from durable work. */
  runtime?: RuntimeFlowExecution;
}

async function executeFlow<
  T,
  TInput = void,
  TSignals extends FlowSignalMap | undefined = undefined,
>(
  name: string,
  fn: (flow: FlowScope<TInput, TSignals>, input: TInput) => Promise<T> | T,
  options?: FlowExecutionOptions<TInput, TSignals>,
): Promise<FlowResult<T>> {
  const runtimeExecution = options?.runtime;
  const currentTime = () => runtimeExecution?.runtime.now() ?? new Date();
  const currentTimeMs = () => currentTime().getTime();
  const isRuntimeExecution = runtimeExecution !== undefined;
  const isResume =
    !!options?.resume ||
    (isRuntimeExecution && runtimeExecution.snapshot.status !== "running");
  const flowId =
    runtimeExecution?.snapshot.flowId ??
    options?.resume ??
    options?.flowId ??
    createFlowId();
  const existing = getExecutionContext();
  const parentFlowId = options?.parentFlowId ?? existing?.flowId;
  const startedAt = currentTimeMs();

  // Load snapshot for resume
  let snapshot: FlowSnapshot | null = null;
  let store: RecordStore | undefined;
  if (!isRuntimeExecution && isResume) {
    store = resolveRecords();
    const raw = await store.get(`${FLOW_KEY_PREFIX}${flowId}`);
    snapshot = raw as FlowSnapshot | null;
    if (!snapshot) {
      throw new Error(`No suspended flow found for flowId: ${flowId}`);
    }
    assertFlowSnapshotResumable(snapshot);
  }

  // Completed step cache (for skip-replay on resume)
  const completedSteps: Record<
    string,
    { output: JsonValue; durationMs: number }
  > = runtimeExecution
    ? completedStepsFromRuntimeSnapshot(runtimeExecution.snapshot)
    : snapshot?.completedSteps
      ? completedStepsForSnapshot(snapshot.completedSteps)
      : {};
  const deliveredSignals = runtimeExecution
    ? {}
    : cloneDeliveredSignals(snapshot);

  // Resolve input: on resume, restore from snapshot; otherwise use options
  const flowInput = (
    runtimeExecution
      ? runtimeExecution.snapshot.input
      : isResume && snapshot?.input !== undefined
        ? snapshot.input
        : options?.input
  ) as TInput;

  const continuation = isRuntimeExecution
    ? runtimeExecution.snapshot.continuation
    : snapshot?.continuation;
  if (isResume && !continuation) {
    throw new Error(
      `Flow ${flowId} cannot resume without a continuation carrier.`,
    );
  }
  const ambientContext = observe.captureContext();
  const flowRun = continuation
    ? observe.resumeRun(sanitizePropagationCarrier(continuation), {
        reason: "flow.resume",
        attributes: { flowId },
      })
    : ambientContext
      ? observe.openChildRun(ambientContext, {
          name,
          rootPrimitive: "flow.run",
          attributes: {
            flowId,
            parentFlowId: parentFlowId ?? null,
            goal: options?.goal ?? null,
          },
        })
      : observe.openRun({
          name,
          rootPrimitive: "flow.run",
          attributes: {
            flowId,
            parentFlowId: parentFlowId ?? null,
            goal: options?.goal ?? null,
          },
        });

  // A nested flow owns a distinct durable run, but remains causally linked to
  // the ambient operation that triggered it.
  if (!continuation && ambientContext) {
    observe.edge({
      edgeType: "triggered",
      from: ambientContext.currentSpanId
        ? { kind: "span", id: ambientContext.currentSpanId }
        : { kind: "run", id: ambientContext.runId },
      to: { kind: "run", id: flowRun.runId },
      attributes: { flowId, parentFlowId: parentFlowId ?? null },
    });
  }

  // Open the flow span: every child trace started inside the flow
  // (e.g. via @use-crux/convex/server ctx.crux.runAction) captures this spanId as
  // its parentSpanId, so the trace tree shows
  // `flow > runtime-flow:start > <child agent>` instead of orphaning
  // the child under the parent's trace boundary.
  let flowSpan!: OpenObservedSpan;
  flowRun.withContext(() => {
    flowSpan = observe.openSpan({
      name,
      primitive: "flow.run",
      attributes: {
        flowId,
        parentFlowId: parentFlowId ?? null,
        goal: options?.goal ?? null,
        resume: isResume,
      },
      // `name` is the authored, required first argument to `flow()` — the run-
      // scoped definition key the indexer joins on, not the random `flowId`.
      definitionRefs: [flowDefinitionRef(name)],
      implicitRun: false,
    });
  });
  const spanId = flowSpan.spanId;
  const resultOperation = flowResultOperation(flowSpan);

  // Track aggregates across steps
  let stepCount = 0;
  let suspendCount = 0;
  let scheduledWorkCount = 0;
  const emittedSuspensionMarkers = new Set<string>();

  // Accumulated step results — pre-populated from snapshot on resume
  const results: Record<string, unknown> = {};
  for (const [label, cached] of Object.entries(completedSteps)) {
    results[label] = cached.output;
  }
  const stepIdentities = createFlowStepIdentityTracker();

  // Create the flow scope
  const scope = {
    flowId,
    input: flowInput,
    results,

    async step<S>(
      label: string,
      stepFn:
        | ((flow: FlowScope<TInput, TSignals>) => Promise<S> | S)
        | (() => Promise<S> | S),
      stepOptions?: StepOptions,
    ): Promise<S> {
      runtimeExecution?.fingerprint.observe(`step:${label}`);
      stepIdentities.use(label);
      stepCount++;
      const stepId = `${slugify(label)}-${stepCount}`;

      // Skip-replay: return cached output if available
      if (completedSteps[label]) {
        const cached = completedSteps[label].output as S;
        results[label] = cached;
        return cached;
      }

      const stepContext = {
        ...getExecutionContext(),
        flowId,
        stepId,
        stepLabel: label,
      };
      const stepStartedAt = currentTimeMs();

      // Capture source location and emit step start hook
      const stepSource = captureSource();

      // Always pass scope to step function — () => T functions ignore the extra arg
      const boundStepFn = () =>
        (stepFn as (flow: FlowScope<TInput, TSignals>) => Promise<S> | S)(
          scope,
        );
      const stepSpan = observe.openSpan({
        name: label,
        primitive: "flow.step",
        definitionRefs: [flowStepDefinitionRef(name, label)],
        attributes: {
          flowId,
          stepId,
          stepLabel: label,
        },
      });
      const wrappedFn = () =>
        runScope(
          {
            kind: "flow-step",
            name: label,
            ...(stepSource
              ? {
                  sourceRef: {
                    file: stepSource.file,
                    line: stepSource.line,
                  },
                }
              : {}),
          },
          {},
          () =>
            stepSpan.withContext(() =>
              runWithExecutionContext(stepContext, () =>
                executeWithRetry(
                  boundStepFn,
                  flowStepRetryOptions(stepOptions),
                ),
              ),
            ),
        );

      try {
        const result = await wrappedFn();

        // Record the step output on the trace so Devtools and other graph
        // readers can inspect it without re-running the Flow.
        if (result !== undefined) {
          stepSpan.withContext(() => {
            observe.artifact({
              kind: "output",
              contentType: "application/json",
              encoding: "json",
              preview: result,
              attributes: { flowId, stepId, stepLabel: label },
            });
          });
        }

        // Cache the step output for potential suspend serialization
        completedSteps[label] = {
          output: result as JsonValue,
          durationMs: currentTimeMs() - stepStartedAt,
        };

        // Populate the results accumulator
        results[label] = result;

        // Emit step end hook
        stepSpan.end();

        return result;
      } catch (error) {
        // Don't emit step end for FlowSuspendedError — it's not a real step error
        if (!(error instanceof FlowSuspendedError)) {
          stepSpan.error(error);
        } else {
          await stepSpan.withContext(async () => {
            await emitFlowSuspensionMarker(error.suspendPoint, {
              flowId,
              stepId,
              stepLabel: label,
              timeout: error.options?.timeout,
              emittedSuspensionMarkers,
            });
          });
          stepSpan.end({ status: "suspended" });
        }
        throw error;
      }
    },

    async suspend<S>(_name: string, _options?: SuspendOptions<S>): Promise<S> {
      suspendCount++;
      const deliveryKey = suspendDeliveryKey(suspendCount, _name);
      runtimeExecution?.fingerprint.observe(`suspend:${_name}`);
      const localSignalSpec = options?.signals?.[_name];
      const localSchema = signalSchemaFor(localSignalSpec);
      const suspendOptions = (
        localSchema ? { ..._options, schema: localSchema } : _options
      ) as SuspendOptions<S> | undefined;
      const payloadSpec = localSignalSpec ?? suspendOptions?.schema;
      const runtimeReplayPayload = runtimeExecution
        ? deliveredRuntimePayload(
            runtimeExecution.deliveredPayloads,
            deliveryKey,
            _name,
          )
        : undefined;
      const replayPayload =
        runtimeReplayPayload !== undefined
          ? runtimeReplayPayload
          : deliveredSignalPayload(deliveredSignals, deliveryKey);
      if (isResume && replayPayload !== undefined) {
        return validateSignalPayload(_name, payloadSpec, replayPayload) as S;
      }

      if (
        runtimeExecution &&
        runtimeTimeoutMatches(runtimeExecution, _name)
      ) {
        if (suspendOptions?.onExpired) {
          await suspendOptions.onExpired({ flowId, suspendedAt: _name });
        }
        throw new FlowExpiredError(_name);
      }

      // On resume, first check for expiration
      if (isResume && snapshot) {
        const timeoutAt = snapshot.timeoutAt as number | undefined;
        if (timeoutAt && currentTimeMs() > timeoutAt) {
          // Flow has expired — invoke callback and throw
          if (suspendOptions?.onExpired) {
            await suspendOptions.onExpired({ flowId, suspendedAt: _name });
          }
          throw new FlowExpiredError(_name);
        }

        // Check if signal exists
        if (store) {
          const signalKey = `${SIGNAL_KEY_PREFIX}${flowId}:${_name}`;
          const signalDoc = await store.get(signalKey);
          if (signalDoc) {
            // Signal found — emit hook and return payload
            const rawPayload = "payload" in signalDoc ? signalDoc.payload : {};
            const payload = validateSignalPayload(
              _name,
              payloadSpec,
              rawPayload,
            ) as S;
            assertFlowJsonValue(payload, { boundary: "signal payload" });
            recordDeliveredSignal(
              deliveredSignals,
              deliveryKey,
              _name,
              payload as JsonValue,
            );
            await consumeFlowSignal(store, flowId, _name);
            return payload;
          }
        }
      }

      if (runtimeExecution) {
        throw new FlowSuspendedError(_name, suspendOptions);
      }

      // Verify store is available before suspending
      const flowStore = store ?? getHooks().records;
      if (!flowStore) {
        throw new Error(
          "flow.suspend() requires a RecordStore. Configure one via config({ storage: { records } }).",
        );
      }

      // Not resuming or no signal yet — suspend
      throw new FlowSuspendedError(_name, suspendOptions);
    },

    async waitUntil(
      _name: string,
      conditionFn: () => boolean | Promise<boolean>,
      _options?: Omit<SuspendOptions, "schema">,
    ): Promise<void> {
      // On resume, check expiration first
      if (isResume && snapshot) {
        const timeoutAt = snapshot.timeoutAt as number | undefined;
        if (timeoutAt && currentTimeMs() > timeoutAt) {
          if (_options?.onExpired) {
            await _options.onExpired({ flowId, suspendedAt: _name });
          }
          throw new FlowExpiredError(_name);
        }
      }

      // Evaluate the condition
      const conditionResult = await conditionFn();
      if (conditionResult) {
        // Condition met — continue execution
        return;
      }

      // Condition not met — verify store and suspend
      const flowStore = store ?? getHooks().records;
      if (!flowStore) {
        throw new Error(
          "flow.waitUntil() requires a RecordStore. Configure one via config({ storage: { records } }).",
        );
      }

      throw new FlowSuspendedError(_name, _options as SuspendOptions);
    },

    async waitFor<TPayload = JsonValue>(
      event: string | FlowWaitForEvent<TPayload>,
      waitOptions?: FlowWaitForOptions,
    ): Promise<TPayload> {
      const eventSpec = normalizeWaitForEvent(event);
      const suspendPoint = `waitFor:${eventSpec.name}`;
      suspendCount++;
      const deliveryKey = suspendDeliveryKey(suspendCount, suspendPoint);
      runtimeExecution?.fingerprint.observe(`waitFor:${eventSpec.name}`);
      const replayPayload = runtimeExecution
        ? deliveredRuntimePayload(
            runtimeExecution.deliveredPayloads,
            deliveryKey,
            suspendPoint,
          )
        : undefined;
      if (isResume && replayPayload !== undefined) {
        return validateWaitForPayload(eventSpec, replayPayload);
      }

      if (
        runtimeExecution &&
        runtimeTimeoutMatches(runtimeExecution, suspendPoint)
      ) {
        throw new FlowExpiredError(suspendPoint);
      }

      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: "flow.waitFor()" });
      }

      const metadata: RuntimeFlowSuspendMetadata = {
        eventName: eventSpec.name,
        match: waitOptions?.match ?? {},
        fingerprint: `waitFor:${eventSpec.name}`,
      };
      throw new FlowSuspendedError(
        suspendPoint,
        { timeout: waitOptions?.timeout },
        metadata,
      );
    },

    async defer<TTask extends RuntimeTaskTarget>(
      taskTarget: TTask,
      input: RuntimeTaskInput<TTask>,
    ): Promise<{ workId: string }> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: "flow.defer()" });
      }
      scheduledWorkCount++;
      runtimeExecution.fingerprint.observe(`defer:${taskTarget.name}`);
      const key = `defer:${scheduledWorkCount}`;
      const recorded = runtimeExecution.snapshot.scheduledWork?.[key];
      if (recorded?.workId) return { workId: recorded.workId };

      const workId = runtimeWorkId();
      runtimeExecution.scheduledWork.push({
        kind: "defer",
        key,
        namespace: runtimeExecution.work.namespace,
        targetId: taskTarget.targetId,
        taskId: workId as unknown as TaskId,
        workId,
        input: runtimeScheduledWorkInput(input, `flow.defer("${key}") input`),
        idleScope: `flow:${flowId}`,
      });
      return { workId };
    },

    async after<TTask extends RuntimeTaskTarget>(
      taskTarget: TTask,
      delay: string,
      input: RuntimeTaskInput<TTask>,
    ): Promise<void> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: "flow.after()" });
      }
      scheduledWorkCount++;
      runtimeExecution.fingerprint.observe(`after:${taskTarget.name}`);
      const key = `after:${scheduledWorkCount}`;
      if (runtimeExecution.snapshot.scheduledWork?.[key]) return;

      runtimeExecution.scheduledWork.push({
        kind: "after",
        key,
        namespace: runtimeExecution.work.namespace,
        targetId: taskTarget.targetId,
        taskId: `${flowId}:${key}:${taskTarget.name}` as TaskId,
        fireAt: new Date(currentTimeMs() + parseDuration(delay)),
        input: runtimeScheduledWorkInput(input, `flow.after("${key}") input`),
        idleScope: `flow:${flowId}`,
      });
    },

    async untilIdle(options: FlowUntilIdleOptions): Promise<void> {
      if (!runtimeExecution) {
        throw runtimeRequiredError({ api: "flow.untilIdle()" });
      }
      if (options.scope !== "current-flow") {
        throw new Error(
          'flow.untilIdle() only supports { scope: "current-flow" } in v1.',
        );
      }
      const idleScope = `flow:${flowId}`;
      const eventName = `crux.idle:${idleScope}`;
      const suspendPoint = `untilIdle:${idleScope}`;
      suspendCount++;
      const deliveryKey = suspendDeliveryKey(suspendCount, suspendPoint);
      runtimeExecution.fingerprint.observe(`waitFor:${eventName}`);
      if (
        runtimeExecution.deliveredPayloads.has(deliveryKey) ||
        runtimeExecution.deliveredPayloads.has(suspendPoint)
      )
        return;

      const count = await runtimeExecution.runtime.store.state.getIdleCount(
        runtimeExecution.work.namespace,
        idleScope,
      );
      const bufferedDeferCount = runtimeExecution.scheduledWork.filter(
        (work) => work.kind === "defer" && work.idleScope === idleScope,
      ).length;
      if (count === 0 && bufferedDeferCount === 0) return;

      throw new FlowSuspendedError(suspendPoint, undefined, {
        eventName,
        match: {},
        fingerprint: `waitFor:${eventName}`,
      });
    },

    cancel(reason?: string): never {
      throw new FlowCancelledError(reason);
    },
  } as FlowScope<TInput, TSignals>;

  // Run the flow function with flow/session metadata while the canonical
  // observability span context is active.
  try {
    const invokeHandler = () =>
      runWithExecutionContext({ ...existing, flowId, parentFlowId }, () =>
        fn(scope, flowInput),
      );
    const result = await flowSpan.withContext(() =>
      runtimeExecution
        ? runWithDeferReplayGuard(invokeHandler)
        : invokeHandler(),
    );

    const completedResult = completedFlowResultPayload(result, flowId);

    if (runtimeExecution) {
      runtimeExecution.fingerprint.complete();
      runtimeExecution.outcome = {
        status: "completed",
        flowSnapshot: runtimeFlowSnapshot(runtimeExecution, {
          status: "completed",
          input: flowInput,
          completedSteps,
          continuation: flowRun.captureContinuation(),
          scheduledWork: runtimeExecution.snapshot.scheduledWork,
        }),
        scheduledWork: runtimeExecution.scheduledWork,
      };
    }

    if (isResume && store && snapshot) {
      const completedAt = currentTimeMs();
      const deliveredSignalsSnapshot =
        deliveredSignalsForSnapshot(deliveredSignals);
      const completedSnapshot: FlowSnapshot = {
        ...snapshot,
        status: "completed",
        completedSteps: completedStepsForSnapshot(completedSteps),
        ...(deliveredSignalsSnapshot
          ? { deliveredSignals: deliveredSignalsSnapshot }
          : {}),
        updatedAt: completedAt,
        completedAt,
        continuation: flowRun.captureContinuation(),
      };
      await store.put(
        `${FLOW_KEY_PREFIX}${flowId}`,
        flowSnapshotForPersistence(completedSnapshot),
      );
    }

    const observedResult = finalizeFlowResult(
      completedResult,
      resultOperation,
    );
    flowSpan.end({
      attributes: { flowStatus: "completed", totalSteps: stepCount },
    });
    flowRun.end();
    return observedResult;
  } catch (error) {
    // Handle suspension — persist state and return suspended result
    if (error instanceof FlowSuspendedError) {
      const suspendedResult = suspendedFlowResultPayload<T>(
        flowId,
        error.suspendPoint,
      );
      if (runtimeExecution) {
        runtimeExecution.fingerprint.complete();
        const timeoutAt = error.options?.timeout
          ? new Date(currentTimeMs() + parseDuration(error.options.timeout))
          : undefined;
        const runtimeDeliveryKey = suspendDeliveryKey(
          suspendCount,
          error.suspendPoint,
        );
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: "flow input" });
        }
        runtimeExecution.outcome = {
          status: "suspended",
          suspension: {
            namespace: runtimeExecution.work.namespace,
            workId: runtimeExecution.work.workId,
            flowId: flowId as RuntimeFlowId,
            targetId: runtimeExecution.work.targetId,
            snapshot: {
              input: runtimeInputValue(flowInput),
              completedSteps: runtimeCompletedSteps(completedSteps),
              fingerprint: runtimeExecution.fingerprint.observed,
              deliveredSuspends: runtimeDeliveredSuspendsForPersistence(
                runtimeExecution.snapshot.deliveredSuspends,
              ),
              continuation: flowRun.captureContinuation(),
              scheduledWork: runtimeExecution.snapshot.scheduledWork,
            },
            suspends: [
              {
                label: error.suspendPoint,
                deliveryKey: runtimeDeliveryKey,
                eventName:
                  error.runtime?.eventName ??
                  runtimeSignalEventName(flowId, error.suspendPoint),
                match: error.runtime?.match ?? {},
                timeoutAt,
              },
            ],
            scheduledWork: runtimeExecution.scheduledWork,
          },
        };

        await flowSpan.withContext(async () => {
          await emitFlowSuspensionMarker(error.suspendPoint, {
            flowId,
            timeout: error.options?.timeout,
            emittedSuspensionMarkers,
          });
        });

        flowSpan.end({
          status: "suspended",
          attributes: {
            suspendedAt: error.suspendPoint,
            totalSteps: stepCount,
          },
        });
        flowRun.suspend({
          reason: "flow.suspend",
          attributes: { flowId, suspendPoint: error.suspendPoint },
        });
        await observe.flush();
        return finalizeFlowResult(suspendedResult, resultOperation);
      }

      const flowStore = store ?? getHooks().records;
      if (flowStore) {
        const timeoutAt = error.options?.timeout
          ? currentTimeMs() + parseDuration(error.options.timeout)
          : undefined;
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: "flow input" });
        }

        const deliveredSignalsSnapshot =
          deliveredSignalsForSnapshot(deliveredSignals);
        const snapshotData: FlowSnapshot = {
          flowId,
          name,
          status: "suspended",
          suspendedAt: error.suspendPoint,
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot
            ? { deliveredSignals: deliveredSignalsSnapshot }
            : {}),
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          continuation: flowRun.captureContinuation(),
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: currentTimeMs(),
          ...(timeoutAt !== undefined ? { timeoutAt } : {}),
          ...(flowInput !== undefined
            ? { input: flowInput as unknown as JsonValue }
            : {}),
        };
        await flowStore.put(
          `${FLOW_KEY_PREFIX}${flowId}`,
          flowSnapshotForPersistence(snapshotData),
        );
      }

      await flowSpan.withContext(async () => {
        await emitFlowSuspensionMarker(error.suspendPoint, {
          flowId,
          timeout: error.options?.timeout,
          emittedSuspensionMarkers,
        });
      });

      flowSpan.end({
        status: "suspended",
        attributes: { suspendedAt: error.suspendPoint, totalSteps: stepCount },
      });
      flowRun.suspend({
        reason: "flow.suspend",
        attributes: { flowId, suspendPoint: error.suspendPoint },
      });
      await observe.flush();
      return finalizeFlowResult(suspendedResult, resultOperation);
    }

    // Handle cancellation
    if (error instanceof FlowCancelledError) {
      const cancelledResult = cancelledFlowResultPayload<T>(
        flowId,
        error.reason,
      );
      if (runtimeExecution) {
        runtimeExecution.fingerprint.complete();
        runtimeExecution.outcome = {
          status: "cancelled",
          flowSnapshot: runtimeFlowSnapshot(runtimeExecution, {
            status: "cancelled",
            input: flowInput,
            completedSteps,
            continuation: flowRun.captureContinuation(),
            scheduledWork: runtimeExecution.snapshot.scheduledWork,
          }),
          scheduledWork: runtimeExecution.scheduledWork,
        };
        flowSpan.end({
          status: "cancelled",
          attributes: {
            cancelReason: error.reason ?? null,
            totalSteps: stepCount,
          },
        });
        flowRun.end({ status: "cancelled" });
        return finalizeFlowResult(cancelledResult, resultOperation);
      }

      const flowStore = store ?? getHooks().records;
      if (flowStore) {
        const cancelledAt = currentTimeMs();
        if (error.reason !== undefined) {
          assertFlowJsonValue(error.reason, {
            boundary: "flow snapshot metadata",
            path: "$.cancelReason",
          });
        }
        if (flowInput !== undefined) {
          assertFlowJsonValue(flowInput, { boundary: "flow input" });
        }
        const deliveredSignalsSnapshot =
          deliveredSignalsForSnapshot(deliveredSignals);
        const snapshotData: FlowSnapshot = {
          flowId,
          name,
          status: "cancelled",
          suspendedAt: "",
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot
            ? { deliveredSignals: deliveredSignalsSnapshot }
            : {}),
          traceContext: flowTraceContext(existing?.sessionId, parentFlowId),
          continuation: flowRun.captureContinuation(),
          createdAt: snapshot?.createdAt ?? startedAt,
          updatedAt: cancelledAt,
          cancelledAt,
          ...(error.reason !== undefined ? { cancelReason: error.reason } : {}),
          ...(flowInput !== undefined
            ? { input: flowInput as unknown as JsonValue }
            : {}),
        };
        await flowStore.put(
          `${FLOW_KEY_PREFIX}${flowId}`,
          flowSnapshotForPersistence(snapshotData),
        );
      }

      flowSpan.end({
        status: "cancelled",
        attributes: {
          cancelReason: error.reason ?? null,
          totalSteps: stepCount,
        },
      });
      flowRun.end({ status: "cancelled" });
      return finalizeFlowResult(cancelledResult, resultOperation);
    }

    // Handle expiration
    if (error instanceof FlowExpiredError) {
      if (runtimeExecution) {
        runtimeExecution.fingerprint.complete();
        runtimeExecution.outcome = {
          status: "completed",
          flowSnapshot: runtimeFlowSnapshot(runtimeExecution, {
            status: "expired",
            input: flowInput,
            completedSteps,
            continuation: flowRun.captureContinuation(),
            scheduledWork: runtimeExecution.snapshot.scheduledWork,
          }),
          scheduledWork: runtimeExecution.scheduledWork,
        };
      }
      const flowStore = runtimeExecution
        ? undefined
        : (store ?? getHooks().records);
      if (flowStore) {
        const expiredAt = currentTimeMs();
        const deliveredSignalsSnapshot =
          deliveredSignalsForSnapshot(deliveredSignals);
        const snapshotData = {
          ...(snapshot ?? {}),
          status: "expired",
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot
            ? { deliveredSignals: deliveredSignalsSnapshot }
            : {}),
          expiredAt,
          updatedAt: expiredAt,
        } as FlowSnapshot;
        await flowStore.put(
          `${FLOW_KEY_PREFIX}${flowId}`,
          flowSnapshotForPersistence(snapshotData),
        );
      }

      flowSpan.error(error, {
        flowStatus: "expired",
        suspendedAt: error.suspendPoint,
        totalSteps: stepCount,
      });
      flowRun.error(error);
      return finalizeFlowResult(
        expiredFlowResultPayload<T>(flowId, error.suspendPoint),
        resultOperation,
      );
    }

    // Signal validation is a recoverable delivery failure: the persisted flow
    // remains suspended so callers can replace the bad signal and resume it.
    if (error instanceof InvalidSignalPayloadError && snapshot) {
      const flowStore = store ?? getHooks().records;
      if (flowStore) {
        const retryableSnapshot: FlowSnapshot = {
          ...snapshot,
          continuation: flowRun.captureContinuation(),
          updatedAt: currentTimeMs(),
        };
        await flowStore.put(
          `${FLOW_KEY_PREFIX}${flowId}`,
          flowSnapshotForPersistence(retryableSnapshot),
        );
      }
      flowSpan.error(error, { flowStatus: "suspended", totalSteps: stepCount });
      flowRun.suspend({
        reason: "flow.signal.invalid",
        attributes: { flowId },
      });
      await observe.flush();
      throw error;
    }

    // A failed resume attempt remains retryable while the persisted snapshot
    // is suspended. Close only this physical segment, not the logical run.
    if (snapshot) {
      const flowStore = store ?? getHooks().records;
      if (flowStore) {
        const deliveredSignalsSnapshot =
          deliveredSignalsForSnapshot(deliveredSignals);
        const retryableSnapshot: FlowSnapshot = {
          ...snapshot,
          completedSteps: completedStepsForSnapshot(completedSteps),
          ...(deliveredSignalsSnapshot
            ? { deliveredSignals: deliveredSignalsSnapshot }
            : {}),
          continuation: flowRun.captureContinuation(),
          updatedAt: currentTimeMs(),
        };
        await flowStore.put(
          `${FLOW_KEY_PREFIX}${flowId}`,
          flowSnapshotForPersistence(retryableSnapshot),
        );
      }
      flowSpan.error(error, { totalSteps: stepCount });
      flowRun.suspend({ reason: "flow.error", attributes: { flowId } });
      await observe.flush();
      throw error;
    }

    flowSpan.error(error, { totalSteps: stepCount });
    flowRun.error(error);
    throw error;
  }
}

function flowTraceContext(
  sessionId: string | undefined,
  parentFlowId: string | undefined,
): JsonObject {
  return {
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(parentFlowId !== undefined ? { parentFlowId } : {}),
  };
}

async function emitFlowSuspensionMarker(
  suspendPoint: string,
  options: {
    flowId: string;
    stepId?: string;
    stepLabel?: string;
    timeout?: string;
    emittedSuspensionMarkers: Set<string>;
  },
): Promise<void> {
  const markerKey = `${options.stepId ?? "flow"}:${suspendPoint}`;
  if (options.emittedSuspensionMarkers.has(markerKey)) return;
  options.emittedSuspensionMarkers.add(markerKey);

  const marker = observe.openSpan({
    name: suspendPoint,
    primitive: "flow.suspension",
    attributes: {
      flowId: options.flowId,
      suspendPoint,
      ...(options.stepId ? { causedByStepId: options.stepId } : {}),
      ...(options.stepLabel ? { causedByStepLabel: options.stepLabel } : {}),
      ...(options.timeout ? { timeout: options.timeout } : {}),
    },
    implicitRun: false,
  });
  marker.end({ status: "suspended" });
}

// ─────────────────────────────────────────────────────────────────
// flow — definition-time factory
// ─────────────────────────────────────────────────────────────────

function normalizeRunArgs(
  args: readonly unknown[],
  handlerExpectsInput: boolean,
): FlowExecutionOptions<unknown> {
  if (handlerExpectsInput) {
    return {
      input: args[0],
      ...(args[1] as FlowRunOptions | undefined),
    };
  }

  if (args.length === 0) {
    return {};
  }

  const first = args[0];
  if (isRunOptionsLike(first)) {
    return first;
  }

  return {
    input: first,
    ...(args[1] as FlowRunOptions | undefined),
  };
}

function isRunOptionsLike(value: unknown): value is FlowRunOptions {
  return (
    isRecord(value) &&
    ("flowId" in value || "parentFlowId" in value || "goal" in value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWaitForEvent<TPayload>(
  event: string | FlowWaitForEvent<TPayload>,
): FlowWaitForEvent<TPayload> {
  return typeof event === "string" ? { name: event } : event;
}

function validateWaitForPayload<TPayload>(
  event: FlowWaitForEvent<TPayload>,
  payload: JsonValue,
): TPayload {
  if (!event.schema) return payload as TPayload;
  return event.schema.parse(payload);
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
): FlowHandle<HandlerOutput<THandler>, HandlerInput<THandler>>;
export function flow<
  const TSignals extends FlowSignalMap,
  THandler extends InferredFlowHandler<TSignals>,
>(
  name: string,
  options: FlowDefinitionOptions<TSignals>,
  handler: THandler,
): FlowHandle<HandlerOutput<THandler>, HandlerInput<THandler>, TSignals>;
export function flow(
  name: string,
  optionsOrHandler:
    | FlowDefinitionOptions<FlowSignalMap>
    | ((
        flow: FlowScope<unknown, FlowSignalMap | undefined>,
        input?: unknown,
      ) => Awaitable<unknown>),
  maybeHandler?: (
    flow: FlowScope<unknown, FlowSignalMap>,
    input?: unknown,
  ) => Awaitable<unknown>,
): FlowHandle<unknown, unknown, FlowSignalMap | undefined> {
  const definitionOptions = isFlowDefinitionOptions(optionsOrHandler)
    ? optionsOrHandler
    : undefined;
  const handler =
    typeof optionsOrHandler === "function" ? optionsOrHandler : maybeHandler;
  if (typeof handler !== "function") {
    throw new TypeError("flow() requires a handler function.");
  }

  const handlerExpectsInput = flowHandlerAcceptsInput(handler);
  const runtimeHandler = handler as (
    flow: FlowScope<unknown, FlowSignalMap | undefined>,
    input?: unknown,
  ) => Awaitable<unknown>;
  const executeHandler = (
    scope: FlowScope<unknown, FlowSignalMap | undefined>,
    input: unknown,
  ) => runtimeHandler(scope, input);

  const createRuntimeTarget = (
    runtimeRef: RuntimeFlowTargetRef,
  ): RuntimeTarget => ({
    targetId: name as RuntimeTargetId,
    kind: "flow" as const,
    async execute({ work }): Promise<RuntimeTargetOutcome> {
      const runtime = runtimeRef.current;
      if (!runtime) {
        return {
          status: "blocked",
          error: {
            code: "TARGET_NOT_FOUND",
            message: `Runtime target \`${name}\` was invoked before its runtime was resolved.`,
            at: new Date(),
          },
        };
      }
      const runtimeFlowId = flowIdForRuntimeWork(work);
      const runtimeSnapshot = await runtime.store.state.getSnapshot(
        runtimeFlowId,
        {
          namespace: work.namespace,
        },
      );
      if (!runtimeSnapshot) {
        return {
          status: "blocked",
          error: {
            code: "TARGET_NOT_FOUND",
            message: `Runtime flow snapshot \`${runtimeFlowId}\` could not be found.`,
            at: runtime.now(),
          },
        };
      }
      const runtimeExecution: RuntimeFlowExecution = {
        runtime,
        work,
        snapshot: runtimeSnapshot,
        fingerprint: createReplayFingerprint({
          recorded:
            runtimeSnapshot.status === "running"
              ? []
              : runtimeSnapshot.fingerprint,
        }),
        deliveredPayloads: await deliveredRuntimePayloads(
          runtime,
          runtimeSnapshot,
        ),
        scheduledWork: [],
      };
      try {
        const result = await executeFlow<
          unknown,
          unknown,
          FlowSignalMap | undefined
        >(
          name,
          executeHandler,
          {
            parentFlowId: runtimeRef.executionOptions?.parentFlowId,
            goal: runtimeRef.executionOptions?.goal,
            runtime: runtimeExecution,
            signals: definitionOptions?.signals,
          },
        );
        runtimeRef.flowResult = result;
        return runtimeExecution.outcome ?? { status: "completed" };
      } catch (error) {
        runtimeRef.error = error;
        throw error;
      }
    },
  });

  async function withRuntime<T>(
    useRuntime: (
      runtime: ResolvedRuntimeEngine,
      runtimeRef: RuntimeFlowTargetRef,
      runtimeDefinition: RuntimeEngineDefinition,
    ) => Promise<T>,
  ): Promise<T> {
    const runtimeDefinition = getHooks().runtimeEngine;
    if (!runtimeDefinition) {
      throw new Error("No Crux runtime engine is configured.");
    }
    const runtimeRef: RuntimeFlowTargetRef = {};
    const newWorkId =
      runtimeDefinition.kind === "in-process" && runtimeDefinition.newWorkId
        ? undefined
        : createRuntimeWorkIdGenerator();
    const runtime = createRuntimeWithHostContext({
      runtime: runtimeDefinition,
      targets: runtimeTargetMap(runtimeRef),
      ...(newWorkId ? { newWorkId } : {}),
      startMaintenance: false,
    });
    runtimeRef.current = runtime;
    try {
      return await useRuntime(runtime, runtimeRef, runtimeDefinition);
    } finally {
      runtime.dispose();
    }
  }

  async function runWithRuntime(
    runOptions: FlowExecutionOptions<unknown, FlowSignalMap | undefined>,
  ): Promise<FlowResult<unknown>> {
    return await withRuntime(async (runtime, runtimeRef, runtimeDefinition) => {
      const flowId = (runOptions.flowId ?? createFlowId()) as RuntimeFlowId;
      const workId =
        runtimeDefinition.kind === "in-process" && runtimeDefinition.newWorkId
          ? runtimeDefinition.newWorkId()
          : runtimeWorkId();
      const input = runtimeInputValue(runOptions.input);
      runtimeRef.executionOptions = runOptions;
      const now = runtime.now();
      const work = await runtime.store.transact(async (tx) => {
        const created = await tx.state.createWork({
          workId,
          namespace: runtime.namespace,
          work: { kind: "flow.resume", flowId },
          targetId: name as RuntimeTargetId,
          idempotencyKey: flowStartResumeKey(workId),
          now,
        });
        await tx.state.putSnapshot({
          flowId,
          workId,
          targetId: name as RuntimeTargetId,
          namespace: runtime.namespace,
          status: "running",
          input,
          completedSteps: {},
          fingerprint: [],
          pendingSuspends: [],
          scheduledWork: {},
          updatedAt: now,
        });
        return created;
      });

      await runtime.kernel.handleWake(wakeEnvelopeForWork(work));
      return runtimeInlineResult(runtimeRef, flowId);
    });
  }

  async function resumeWithRuntime(
    flowId: string,
    options?: FlowResumeOptions,
  ): Promise<FlowResult<unknown>> {
    return await withRuntime(async (runtime, runtimeRef) => {
      runtimeRef.executionOptions = options;
      const snapshot = await runtime.store.state.getSnapshot(
        flowId as RuntimeFlowId,
        {
          namespace: runtime.namespace,
        },
      );
      if (!snapshot) {
        throw runtimeFlowNotFoundError({
          api: `${name}.resume()`,
          flowId,
        });
      }
      const current = await runtime.store.state.getWork(snapshot.workId, {
        namespace: runtime.namespace,
      });
      if (!current) {
        throw runtimeFlowWorkNotFoundError({
          api: `${name}.resume()`,
          flowId,
        });
      }
      if (snapshot.status !== "suspended") {
        throw runtimeFlowNotResumableError({
          api: `${name}.resume()`,
          flowId,
          status: snapshot.status,
          subject: "flow snapshot",
        });
      }
      const idempotencyKey = flowManualResumeKey(
        snapshot.workId,
        runtime.now(),
      );
      const wakeWork =
        current.status === "suspended"
          ? await runtime.store.state.setWorkPending(snapshot.workId, {
              namespace: runtime.namespace,
              work: runtimeResumeWork(snapshot, runtime.now()),
              idempotencyKey,
              now: runtime.now(),
            })
          : current;
      if (!wakeWork) {
        throw runtimeFlowNotResumableError({
          api: `${name}.resume()`,
          flowId,
          status: current.status,
        });
      }

      await runtime.kernel.handleWake({
        ...wakeEnvelopeForWork(wakeWork),
        idempotencyKey:
          current.status === "suspended"
            ? idempotencyKey
            : wakeWork.idempotencyKey,
      });
      return runtimeInlineResult(runtimeRef, flowId);
    });
  }

  async function signalWithRuntime(
    flowId: string,
    signalName: string,
    payload: JsonValue,
    options?: FlowSignalOptions,
  ): Promise<void> {
    await withRuntime(async (runtime) => {
      const persistedPayload = flowValueForPersistence(payload, {
        boundary: "signal payload",
      });
      await runtime.kernel.emitEvent({
        namespace: runtime.namespace,
        name: runtimeSignalEventName(flowId, signalName),
        payload: persistedPayload,
        eventId: runtimeSignalEventId(flowId, signalName),
      });
      if (options?.resume !== false) {
        await runtime.dispatcher.nudge();
      }
    });
  }

  function runtimeInlineResult(
    runtimeRef: RuntimeFlowTargetRef,
    flowId: string,
  ): FlowResult<unknown> {
    if (runtimeRef.error) throw runtimeRef.error;
    if (runtimeRef.flowResult) return runtimeRef.flowResult;
    throw new Error(
      `Runtime flow \`${flowId}\` did not produce an inline result.`,
    );
  }

  registerRuntimeTarget(name, createRuntimeTarget);

  const handle = {
    name,

    run(...args: readonly unknown[]): Promise<FlowResult<unknown>> {
      const runOptions = normalizeRunArgs(args, handlerExpectsInput);
      if (getHooks().runtimeEngine) {
        return runWithRuntime({
          ...runOptions,
          signals: definitionOptions?.signals,
        });
      }
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(
        name,
        executeHandler,
        {
          ...runOptions,
          signals: definitionOptions?.signals,
        },
      );
    },

    resume(
      flowId: string,
      options?: FlowResumeOptions,
    ): Promise<FlowResult<unknown>> {
      if (getHooks().runtimeEngine) {
        return resumeWithRuntime(flowId, options);
      }
      return executeFlow<unknown, unknown, FlowSignalMap | undefined>(
        name,
        executeHandler,
        {
          parentFlowId: options?.parentFlowId,
          goal: options?.goal,
          resume: flowId,
          signals: definitionOptions?.signals,
        },
      );
    },

    async signal(
      flowId: string,
      signalName: string,
      payload: JsonValue | FlowSignalOptions = {},
      options?: FlowSignalOptions,
    ): Promise<void> {
      const signalSpec = definitionOptions?.signals[signalName];
      const payloadIsOptions =
        isNoPayloadSignal(signalSpec) && isFlowSignalOptions(payload);
      const signalOptions =
        payloadIsOptions && options === undefined ? payload : options;
      const signalPayload = payloadIsOptions ? {} : payload;
      const parsedPayload = validateSignalPayload(
        signalName,
        signalSpec,
        signalPayload,
      );
      if (getHooks().runtimeEngine) {
        await signalWithRuntime(
          flowId,
          signalName,
          parsedPayload as JsonValue,
          signalOptions,
        );
        return;
      }
      await signalFlow(flowId, signalName, parsedPayload as JsonValue);
    },

    async cancel(flowId: string): Promise<void> {
      if (getHooks().runtimeEngine) {
        await cancelRuntimeFlow({ api: `${name}.cancel()`, flowId });
        return;
      }
      await cancelFlow(flowId);
    },
  };

  return Object.freeze(handle) as FlowHandle<
    unknown,
    unknown,
    FlowSignalMap | undefined
  >;
}

function deliveredRuntimePayload(
  deliveredPayloads: ReadonlyMap<string, JsonValue>,
  primaryKey: string,
  fallbackKey: string,
): JsonValue | undefined {
  if (deliveredPayloads.has(primaryKey))
    return deliveredPayloads.get(primaryKey);
  if (deliveredPayloads.has(fallbackKey))
    return deliveredPayloads.get(fallbackKey);
  return undefined;
}

function isFlowDefinitionOptions(
  value: unknown,
): value is FlowDefinitionOptions<FlowSignalMap> {
  return isRecord(value) && isRecord(value.signals);
}

function isFlowSignalOptions(value: unknown): value is FlowSignalOptions {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.resume === "boolean"
  );
}
