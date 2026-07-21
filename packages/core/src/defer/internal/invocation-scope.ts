import {
  captureAsyncScope,
  type CapturedAsyncScope,
} from "../../async-scope/internal/carrier";
import { currentScope, resolveWritableScope } from "../../scope/kernel";
import type { ExecutionScope } from "../../scope/contracts";
import { createDeferError } from "../errors";
import type { DeferredCallback } from "../types";
import {
  deferControllerForScope,
  setScopeDeferController,
  type DeferRegistrationContext,
  type DeferRegistrationScope,
} from "./context";
import type { DurableDeferEvidenceHooks } from "./durable";
import {
  createInvocationDeferServices,
  type InvocationDeferServices,
} from "./invocation-services";
import type {
  DeferredScheduledObservation,
  DeferEvidencePolicy,
} from "./observability";
import { scheduleInvocationDeferDrain } from "./retained-task";
import {
  createCapturedDeferWorkId,
  snapshotNamedDeferInput,
} from "./named-input";

type DeferredCallbackOutcome =
  | "completed"
  | "failed"
  | "timed-out"
  | "cancelled";

export interface InlineRegistration {
  readonly sequence: number;
  readonly depth: number;
  readonly callback: DeferredCallback;
  readonly capturedScope: CapturedAsyncScope;
  readonly observation: DeferredScheduledObservation;
}

/** Result retained internally for shutdown, tests, and later diagnostics. */
export interface DeferredDrainResult {
  readonly callbacks: readonly {
    readonly sequence: number;
    readonly outcome: DeferredCallbackOutcome;
    readonly error?: unknown;
    readonly skipReason?: "scope-outcome";
  }[];
  readonly timedOut: boolean;
  readonly cancelled: boolean;
}

/** Internal barriers created when an invocation is sealed. */
export interface DeferredDrainHandle {
  readonly committed: Promise<void>;
  readonly settled: Promise<DeferredDrainResult>;
  /** Full retained-task settlement returned to the scope kernel for tracking. */
  readonly retained: Promise<void>;
}

/** Per-execution-scope deferred-work controller. */
export interface ScopeDeferController extends DeferRegistrationScope {
  readonly executionScope: ExecutionScope;
  readonly callbackRetention: "retained" | "unretained";
  readonly signal: AbortSignal;
  readonly namedEvidenceHooks: DurableDeferEvidenceHooks;
  cancel(reason?: unknown): void;
  onDrainSettled(
    hook: (result: DeferredDrainResult) => void | PromiseLike<void>,
  ): void;
  getDrainHandle(): DeferredDrainHandle;
}

/** Create and persist the deferred-work controller for one execution scope. */
export function createScopeDeferController(
  executionScope: ExecutionScope,
  services: InvocationDeferServices,
): ScopeDeferController {
  const registrations: InlineRegistration[] = [];
  const drainSettledHooks: Array<
    (result: DeferredDrainResult) => void | PromiseLike<void>
  > = [];
  let drainClosed = false;
  let nextInlineSequence = 0;
  let nextNamedCaptureSequence = 0;
  let handle: DeferredDrainHandle | undefined;
  let controller: ScopeDeferController;

  controller = Object.freeze({
    executionScope,
    callbackRetention: services.callbackRetention,
    signal: services.signal,
    namedEvidenceHooks: services.namedEvidenceHooks,
    cancel: services.cancel,
    onDrainSettled: (hook) => drainSettledHooks.push(hook),
    getDrainHandle() {
      if (!handle) {
        throw new TypeError("The defer controller has not started closing.");
      }
      return handle;
    },
    registerInline(callback, registration) {
      // A retained drain runs after the kernel scope is sealed. Preserve the
      // existing nested-defer exception only while that drain is still open.
      const origin = currentScope() ?? executionScope;
      const writable =
        registration.phase === "drain" &&
        !drainClosed &&
        origin === executionScope
          ? executionScope
          : resolveWritableScope(origin, {
              phase: registration.phase,
            });
      if (writable === "sealed" || drainClosed) throwInlineScopeSealed();
      if (writable !== executionScope) {
        const routed =
          deferControllerForScope(writable) ??
          createScopeDeferController(writable, services);
        if (routed === controller) throwInlineScopeSealed();
        return routed.registerInline(callback, registration);
      }
      assertInlineRegistrationAllowed(services, registration);
      const policy: DeferEvidencePolicy =
        registration.evidence ?? executionScope.policies.evidence;
      const sequence = nextInlineSequence;
      nextInlineSequence += 1;
      if (executionScope.policies.drain === "capture") {
        services.evidence.recordInlineCaptured(
          sequence,
          policy,
          executionScope.descriptor,
        );
        services.recordCallback();
        return "captured";
      }
      const observation = services.evidence.recordInlineScheduled(
        sequence,
        policy,
        executionScope.descriptor,
      );
      registrations.push({
        sequence,
        depth: registration.depth,
        callback,
        capturedScope: captureAsyncScope(),
        observation,
      });
      services.recordCallback();
      return "deferred";
    },
    stageNamed(target, input) {
      const origin = currentScope() ?? executionScope;
      const writable = resolveWritableScope(origin);
      if (writable === "sealed") throwNamedScopeSealed("stage");
      if (writable !== executionScope) {
        const routed =
          deferControllerForScope(writable) ??
          createScopeDeferController(writable, services);
        return routed.stageNamed(target, input);
      }
      assertNamedScopeOpen(writable, "stage");
      if (executionScope.policies.drain === "capture") {
        const acceptedInput = snapshotNamedDeferInput(target, input);
        const workId = createCapturedDeferWorkId();
        services.evidence.recordNamedCaptured({
          sequence: nextNamedCaptureSequence,
          policy: executionScope.policies.evidence,
          targetId: target.targetId,
          workId,
          acceptedInput,
          scope: executionScope.descriptor,
        });
        nextNamedCaptureSequence += 1;
        return Promise.resolve(
          Object.freeze({
            kind: "deferred.work" as const,
            workId,
            targetId: target.targetId,
          }),
        );
      }
      return services.stageNamed(target, input);
    },
    trackCommit(operation) {
      assertNamedScopeOpen(executionScope, "track");
      services.trackCommit(operation);
    },
  } satisfies ScopeDeferController);

  setScopeDeferController(executionScope, controller);
  executionScope.onClose((outcome) => {
    handle ??= scheduleInvocationDeferDrain(
      controller,
      services,
      registrations,
      drainSettledHooks,
      () => {
        drainClosed = true;
      },
      outcome,
    );
    return handle.retained;
  });
  return controller;
}

function assertInlineRegistrationAllowed(
  services: InvocationDeferServices,
  registration: DeferRegistrationContext,
): void {
  if (!services.supportsInline) {
    throw createDeferError({
      code: "DEFER_CAPABILITY_MISSING",
      message:
        "The active host does not support inline defer(callback). Use await defer(target, input) with a configured Runtime, or install a host binding.",
    });
  }
  if (!services.hasCallbackCapacity()) {
    throw createDeferError({
      code: "DEFER_LIMIT_EXCEEDED",
      message: `defer() exceeded the host callback limit of ${services.limits.maxCallbacks}.`,
    });
  }
  if (
    registration.phase === "drain" &&
    registration.depth > services.limits.maxNestingDepth
  ) {
    throw createDeferError({
      code: "DEFER_LIMIT_EXCEEDED",
      message: `defer() exceeded the host nesting limit of ${services.limits.maxNestingDepth}.`,
    });
  }
}

function assertNamedScopeOpen(
  scope: ExecutionScope,
  operation: "stage" | "track",
): void {
  if (scope.state === "open") return;
  throwNamedScopeSealed(operation);
}

function throwNamedScopeSealed(operation: "stage" | "track"): never {
  throw createDeferError({
    code: "DEFER_SCOPE_SEALED",
    message:
      operation === "stage"
        ? "defer() cannot stage durable work after sealing."
        : "defer() cannot track durable acceptance after sealing.",
  });
}

function throwInlineScopeSealed(): never {
  throw createDeferError({
    code: "DEFER_SCOPE_SEALED",
    message: "defer() cannot register work after its invocation was sealed.",
  });
}
