import type { ExecutionScope } from "../../scope/contracts";
import type {
  CruxHostBinding,
  DeferLifetimeLimits,
  ScopeRetainedTask,
} from "../../scope/types";
import { enqueueRetainedTask } from "../../scope/state";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type { DeferInvocationOutcome } from "../host-types";
import { SERVERLESS_DEFER_POLICY } from "../serverless/policy";
import type { DeferredWorkRef } from "../types";
import { createDeferCommitBarrier } from "./commit-barrier";
import {
  createDurableDeferController,
  type DurableDeferEvidenceHooks,
} from "./durable";
import {
  createDeferScopeObservability,
  type DeferScopeObservability,
} from "./observability";

/** Invocation-owned services shared by every per-scope defer controller. */
export interface InvocationDeferServices {
  readonly invocationScope: ExecutionScope;
  readonly limits: DeferLifetimeLimits;
  readonly supportsInline: boolean;
  readonly durableFinalization: boolean;
  readonly signal: AbortSignal;
  readonly abortController: AbortController;
  readonly evidence: DeferScopeObservability;
  readonly namedEvidenceHooks: DurableDeferEvidenceHooks;
  schedule(task: ScopeRetainedTask): void;
  hasCallbackCapacity(): boolean;
  recordCallback(): void;
  stageNamed(
    target: RuntimeTaskTarget,
    input: unknown,
  ): Promise<DeferredWorkRef>;
  trackCommit(operation: PromiseLike<unknown>): void;
  commit(outcome: DeferInvocationOutcome): Promise<void>;
  cancel(reason?: unknown): void;
}

/** Create the root-owned durable, evidence, limit, and cancellation services. */
export function createInvocationDeferServices(
  invocationScope: ExecutionScope,
  binding: CruxHostBinding,
  options: {
    readonly acceptanceMode?: boolean;
    readonly abortController?: AbortController;
  } = {},
): InvocationDeferServices {
  return createDeferServices(
    invocationScope,
    {
      limits: binding.limits ?? SERVERLESS_DEFER_POLICY,
      supportsInline: binding.supportsInline ?? true,
      durableFinalization: binding.durableFinalization ?? false,
      schedule: (task) => enqueueRetainedTask(invocationScope, task),
    },
    options,
  );
}

/**
 * Create root-owned defer services for a long-lived-process primitive.
 *
 * Primitive drains start immediately at scope close. No host retention claim
 * is made; serverless teardown still requires an invocation host binding.
 */
export function createPrimitiveDeferServices(
  rootScope: ExecutionScope,
): InvocationDeferServices {
  return createDeferServices(
    rootScope,
    {
      limits: SERVERLESS_DEFER_POLICY,
      supportsInline: true,
      durableFinalization: false,
      schedule(task) {
        void task.run().catch((error: unknown) => {
          console.error(
            "[crux] primitive deferred work escaped its contained drain.",
            error,
          );
        });
      },
    },
    { acceptanceMode: true },
  );
}

interface DeferServiceCapabilities {
  readonly limits: DeferLifetimeLimits;
  readonly supportsInline: boolean;
  readonly durableFinalization: boolean;
  readonly schedule: (task: ScopeRetainedTask) => void;
}

function createDeferServices(
  invocationScope: ExecutionScope,
  capabilities: DeferServiceCapabilities,
  options: {
    readonly acceptanceMode?: boolean;
    readonly abortController?: AbortController;
  },
): InvocationDeferServices {
  const { limits, supportsInline, durableFinalization, schedule } =
    capabilities;
  let callbackCount = 0;
  const commitBarrier = createDeferCommitBarrier();
  const abortController = options.abortController ?? new AbortController();
  const evidence = createDeferScopeObservability();
  const namedEvidenceHooks = createNamedEvidenceHooks(evidence);
  const durable = createDurableDeferController(
    { durableFinalization },
    namedEvidenceHooks,
    { acceptanceMode: options.acceptanceMode ?? false },
  );

  return Object.freeze({
    invocationScope,
    limits,
    supportsInline,
    durableFinalization,
    signal: abortController.signal,
    abortController,
    evidence,
    namedEvidenceHooks,
    schedule,
    hasCallbackCapacity: () => callbackCount < limits.maxCallbacks,
    recordCallback: () => {
      callbackCount += 1;
    },
    stageNamed(target, input) {
      const operation = durable.stage(target, input);
      commitBarrier.track(operation);
      return operation;
    },
    trackCommit: (operation) => commitBarrier.track(operation),
    commit: (outcome) => durable.commit(outcome, commitBarrier.settle()),
    cancel(reason) {
      abortController.abort(
        reason ?? new Error("Deferred callback drain was cancelled."),
      );
    },
  } satisfies InvocationDeferServices);
}

function createNamedEvidenceHooks(
  evidence: DeferScopeObservability,
): DurableDeferEvidenceHooks {
  return {
    ensurePublicTraceId: () => evidence.ensurePublicTraceId(),
    onStaged(input) {
      const observation = evidence.recordNamedScheduled({
        sequence: input.sequence,
        policy: "public",
        targetId: input.targetId,
        workId: input.workId,
        scopeId: input.scopeId,
        scheduledSpanId: input.scheduledSpanId,
      });
      return observation.spanId ? { spanId: observation.spanId } : {};
    },
    onTerminal(intents, intentState) {
      for (const intent of intents) {
        evidence.markNamedTerminal(
          {
            policy: "public",
            sequence: intent.sequence,
            mode: "named",
            scheduledAtMs: intent.scheduledAtMs,
            workId: intent.workId,
            targetId: intent.targetId,
            scopeId: intent.scopeId,
          },
          intentState,
        );
      }
    },
  };
}
