/** Durable Runtime bridge owned by one invocation defer scope. */

import { getHooks } from "../../runtime/runtime";
import { createRuntimeWithHostContext } from "../../runtime/api/host-context";
import { runtimeRequiredError } from "../../runtime/api/runtime-required";
import {
  runtimeTargetMap,
  type RuntimeTargetRuntimeRef,
} from "../../runtime/api/target-registry";
import type { RuntimeTaskTarget } from "../../runtime/api/task";
import type { ResolvedRuntimeEngine } from "../../runtime/api/create-runtime";
import type {
  DeferredIntentId,
  DeferredScopeId,
  Lease,
} from "../../runtime/ports";
import {
  assertRuntimeJsonValue,
  cloneRuntimeJsonValue,
} from "../../runtime/engine/json-value";
import { startLeaseExtensionHeartbeat } from "../../runtime/engine/kernel-leases";
import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from "../host-types";
import type { DeferredWorkRef } from "../types";
import { createDeferError } from "../errors";

const DEFER_SCOPE_LEASE_TTL_MS = 60_000;

interface DurableSession {
  readonly runtime: ResolvedRuntimeEngine;
  readonly scopeId: DeferredScopeId;
  lease: Lease;
  readonly stopHeartbeat: () => void;
}

/** Package-private durable operations attached to one invocation scope. */
export interface DurableDeferController {
  stage(target: RuntimeTaskTarget, input: unknown): Promise<DeferredWorkRef>;
  commit(
    outcome: DeferInvocationOutcome,
    registrations: Promise<void>,
  ): Promise<void>;
}

/** Optional evidence hooks so named durability can update public spans. */
export interface DurableDeferEvidenceHooks {
  onStaged(input: {
    readonly sequence: number;
    readonly targetId: string;
    readonly workId: string;
    readonly scopeId: string;
    readonly scheduledAtMs: number;
  }): void;
  onTerminal(
    intents: readonly {
      readonly sequence: number;
      readonly scheduledAtMs: number;
    }[],
    intentState: "released" | "abandoned",
  ): void;
}

/** Create a lazy Runtime bridge; inline-only invocations allocate nothing. */
export function createDurableDeferController(
  lifetime: DeferLifetimeCapability,
  evidence?: DurableDeferEvidenceHooks,
): DurableDeferController {
  let sessionPromise: Promise<DurableSession> | undefined;
  let nextIntent = 0;
  const stagedIntents: {
    sequence: number;
    scheduledAtMs: number;
  }[] = [];

  async function ensureSession(): Promise<DurableSession> {
    sessionPromise ??= createSession();
    return await sessionPromise;
  }

  async function createSession(): Promise<DurableSession> {
    if (!lifetime.durableFinalization) {
      throw createDeferError({
        code: "DEFER_CAPABILITY_MISSING",
        message:
          "The active host cannot finalize named deferred work before committing its result.",
      });
    }
    const definition = getHooks().runtimeEngine;
    if (!definition)
      throw runtimeRequiredError({ api: "defer(target, input)" });

    const runtimeRef: RuntimeTargetRuntimeRef = {};
    const runtime = createRuntimeWithHostContext({
      runtime: definition,
      targets: runtimeTargetMap(runtimeRef),
      startMaintenance: false,
    });
    runtimeRef.current = runtime;
    const scopeId = nextDeferredId("scope") as DeferredScopeId;
    const lease = await runtime.store.leases.claim(`defer:${scopeId}`, {
      ttlMs: DEFER_SCOPE_LEASE_TTL_MS,
    });
    if (!lease) {
      runtime.dispose();
      throw new Error(
        `Could not claim deferred invocation lease \`${scopeId}\`.`,
      );
    }

    let activeLease = lease;
    const heartbeat = startLeaseExtensionHeartbeat(
      {
        store: runtime.store,
        leaseTtlMs: DEFER_SCOPE_LEASE_TTL_MS,
      },
      lease,
      (extended) => {
        activeLease = extended;
      },
    );
    const session: DurableSession = {
      runtime,
      scopeId,
      get lease() {
        return activeLease;
      },
      set lease(value) {
        activeLease = value;
      },
      stopHeartbeat: () => heartbeat.stop(),
    };
    return session;
  }

  async function cleanup(session: DurableSession): Promise<void> {
    session.stopHeartbeat();
    await session.runtime.store.leases.release(session.lease);
    session.runtime.dispose();
  }

  return {
    async stage(target, input) {
      if (input === undefined) {
        throw createDeferError({
          code: "DEFER_TARGET_INPUT_REQUIRED",
          message: `Named defer target \`${target.name}\` requires a JSON input argument.`,
        });
      }
      assertRuntimeJsonValue(input, "deferred target input");
      const acceptedInput = cloneRuntimeJsonValue(
        input,
        "deferred target input",
      );
      const session = await ensureSession();
      const sequence = nextIntent;
      nextIntent += 1;
      const intent = await session.runtime.kernel.stageDeferredIntent({
        namespace: session.runtime.namespace,
        scopeId: session.scopeId,
        intentId: `${session.scopeId}:${sequence + 1}` as DeferredIntentId,
        leaseToken: session.lease.token,
        leaseExpiresAt: session.lease.expiresAt,
        targetId: target.targetId,
        input: acceptedInput,
      });
      const scheduledAtMs = Date.now();
      stagedIntents.push({ sequence, scheduledAtMs });
      evidence?.onStaged({
        sequence,
        targetId: intent.targetId,
        workId: intent.workId,
        scopeId: session.scopeId,
        scheduledAtMs,
      });
      return Object.freeze({
        kind: "deferred.work" as const,
        workId: intent.workId,
        targetId: intent.targetId,
      });
    },
    async commit(outcome, registrations) {
      try {
        await registrations;
      } catch (error) {
        const session = await settledSession(sessionPromise);
        if (session) {
          try {
            await session.runtime.kernel.abandonDeferredScope({
              namespace: session.runtime.namespace,
              scopeId: session.scopeId,
              leaseToken: session.lease.token,
              reason:
                "A named deferred registration failed before finalization.",
            });
            evidence?.onTerminal(stagedIntents, "abandoned");
            stagedIntents.length = 0;
          } catch {
            // Preserve the original strict registration failure.
          } finally {
            await cleanup(session);
          }
        }
        throw error;
      }

      const session = await settledSession(sessionPromise);
      if (!session) return;
      try {
        const result = await session.runtime.kernel.finalizeDeferredScope({
          namespace: session.runtime.namespace,
          scopeId: session.scopeId,
          leaseToken: session.lease.token,
          outcome,
        });
        if (result.terminal !== "finalized") {
          throw new Error(
            `Deferred invocation \`${session.scopeId}\` was abandoned before finalization.`,
          );
        }
        evidence?.onTerminal(stagedIntents, "released");
        stagedIntents.length = 0;
      } catch (error) {
        try {
          await session.runtime.kernel.abandonDeferredScope({
            namespace: session.runtime.namespace,
            scopeId: session.scopeId,
            leaseToken: session.lease.token,
            reason: "Deferred invocation finalization failed before commit.",
          });
          evidence?.onTerminal(stagedIntents, "abandoned");
          stagedIntents.length = 0;
        } catch {
          // Preserve the finalization failure that poisoned the host result.
        }
        throw error;
      } finally {
        await cleanup(session);
      }
    },
  };
}

async function settledSession(
  promise: Promise<DurableSession> | undefined,
): Promise<DurableSession | undefined> {
  if (!promise) return undefined;
  try {
    return await promise;
  } catch {
    return undefined;
  }
}

let deferredIdCounter = 0;

function nextDeferredId(kind: "scope"): string {
  deferredIdCounter += 1;
  const uuid = globalThis.crypto?.randomUUID?.();
  return `defer_${kind}_${uuid ?? `${Date.now().toString(36)}_${deferredIdCounter.toString(36)}`}`;
}
