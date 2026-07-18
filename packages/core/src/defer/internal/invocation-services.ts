import type { ExecutionScope } from "../../scope/contracts";
import { enqueueRetainedTask } from "../../scope/state";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from "../host-types";
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
  readonly lifetime: DeferLifetimeCapability;
  readonly signal: AbortSignal;
  readonly abortController: AbortController;
  readonly evidence: DeferScopeObservability;
  readonly namedEvidenceHooks: DurableDeferEvidenceHooks;
  schedule(task: import("../host-types").DeferScheduledTask): void;
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
  lifetime: DeferLifetimeCapability,
  options: {
    readonly retention?: "lifetime" | "binding";
    readonly acceptanceMode?: boolean;
  } = {},
): InvocationDeferServices {
  let callbackCount = 0;
  const commitBarrier = createDeferCommitBarrier();
  const abortController = new AbortController();
  const evidence = createDeferScopeObservability({
    completion: lifetime.completion,
  });
  const namedEvidenceHooks = createNamedEvidenceHooks(evidence, lifetime);
  const durable = createDurableDeferController(lifetime, namedEvidenceHooks, {
    acceptanceMode: options.acceptanceMode ?? false,
  });

  return Object.freeze({
    invocationScope,
    lifetime,
    signal: abortController.signal,
    abortController,
    evidence,
    namedEvidenceHooks,
    schedule: (task) =>
      options.retention === "binding"
        ? enqueueRetainedTask(invocationScope, task)
        : lifetime.schedule(task),
    hasCallbackCapacity: () => callbackCount < lifetime.limits.maxCallbacks,
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
  lifetime: DeferLifetimeCapability,
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
            completion: lifetime.completion,
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
