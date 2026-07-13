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
import { createCruxSpanId } from "../../observability";
import { createRuntimeError } from "../../runtime/engine/errors";
import { startLeaseExtensionHeartbeat } from "../../runtime/engine/kernel-leases";
import {
  isRuntimeNamedDeferProvenance,
  namedDeferProvenanceAsJson,
  type RuntimeNamedDeferProvenance,
} from "../../runtime/engine/named-defer-evidence";
import type {
  DeferInvocationOutcome,
  DeferLifetimeCapability,
} from "../host-types";
import type { DeferredWorkRef } from "../types";
import { createDeferError } from "../errors";

const DEFER_SCOPE_LEASE_TTL_MS = 60_000;

/**
 * Durable session state for one invocation scope.
 *
 * Heartbeat transitions are explicit:
 * - successful durable renew advances `lease`
 * - failed durable renew records `fencePoisoned`, stops future beats, and
 *   best-effort releases the just-extended lease-store ownership so maintenance
 *   can reclaim after the durable scope expiry
 * - pre-first-stage renew (`scope: null`) is allowed and still advances the
 *   active lease so the owner keeps lease-store ownership before the first
 *   stage creates the scope row
 * - non-open or lease-mismatched persisted scopes poison the session
 *
 * Sticky poison is intentional: after poison the heartbeat has already stopped
 * and released ownership; commit/stage reject rather than retry endlessly.
 */
interface DurableSession {
  readonly runtime: ResolvedRuntimeEngine;
  readonly scopeId: DeferredScopeId;
  lease: Lease;
  /** Set when lease-store extend succeeded but durable renew failed. */
  fencePoisoned?: unknown;
  stopHeartbeat: () => void;
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
  /** Open/capture the public trace before durable acceptance. */
  ensurePublicTraceId?(): string;
  onStaged(input: {
    readonly sequence: number;
    readonly targetId: string;
    readonly workId: string;
    readonly scopeId: string;
    readonly scheduledAtMs: number;
    /** Predetermined span id already persisted on the staged intent. */
    readonly scheduledSpanId: string;
  }): {
    readonly spanId?: string;
  } | void;
  onTerminal(
    intents: readonly {
      readonly sequence: number;
      readonly scheduledAtMs: number;
      readonly workId: string;
      readonly targetId: string;
      readonly scopeId: string;
    }[],
    intentState: "released" | "abandoned",
  ): void;
  /**
   * Fired after each durable renew attempt settles (success or poison).
   * Tests await this deterministic signal instead of racing microtasks.
   */
  onHeartbeat?(outcome: "renewed" | "poisoned"): void;
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
    workId: string;
    targetId: string;
    scopeId: string;
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
    const session: DurableSession = {
      runtime,
      scopeId,
      get lease() {
        return activeLease;
      },
      set lease(value) {
        activeLease = value;
      },
      stopHeartbeat: () => {},
    };
    const heartbeat = startLeaseExtensionHeartbeat(
      {
        store: runtime.store,
        leaseTtlMs: DEFER_SCOPE_LEASE_TTL_MS,
      },
      lease,
      async (extended) => {
        // Persist fencing expiry before advancing the session lease. A failed
        // scope renew must not leave commit using unpersisted fencing state.
        try {
          const renewed = await runtime.kernel.renewDeferredScopeLease({
            namespace: runtime.namespace,
            scopeId,
            leaseToken: activeLease.token,
            leaseExpiresAt: extended.expiresAt,
          });
          // Renew semantics:
          // - scope null before first stage: allowed; advance active lease
          // - open + matching token: renewed true (putScope updated expiry)
          // - open + token mismatch: throws LEASE_LOST (caught → poison)
          // - non-open: renewed false; poison so production heartbeat stops
          if (renewed.scope && renewed.scope.finalization.state !== "open") {
            throw createRuntimeError({
              code: "LEASE_LOST",
              whatFailed: `Deferred invocation \`${scopeId}\` is no longer open.`,
              why: "The scope was finalized or abandoned before its heartbeat could renew fencing.",
              whatStillWorks:
                "The terminal transition remains durable; this owner cannot commit under stale fencing.",
              nextStep:
                "No action is needed for an isolated race. Check host liveness if this repeats.",
            });
          }
          activeLease = extended;
          evidence?.onHeartbeat?.("renewed");
        } catch (error) {
          // Explicit poison transition: stop beats, release the just-extended
          // lease-store ownership, keep sticky poison for commit/stage.
          session.fencePoisoned = error;
          session.stopHeartbeat();
          try {
            await runtime.store.leases.release(extended);
          } catch {
            // Best-effort release; cleanup remains idempotent.
          }
          evidence?.onHeartbeat?.("poisoned");
          throw error;
        }
      },
    );
    session.stopHeartbeat = () => heartbeat.stop();
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
      assertFenceHealthy(session);
      const sequence = nextIntent;
      nextIntent += 1;
      const scheduledAtMs = Date.now();
      // Capture the public trace and a predetermined scheduled span id before
      // durable acceptance so released work can emit `defer.run` with a
      // triggered edge after restart / another process without Catalog noise.
      const traceId = evidence?.ensurePublicTraceId?.();
      const provisionalScheduledSpanId = createCruxSpanId();
      const provisionalProvenance: RuntimeNamedDeferProvenance = {
        mode: "named",
        sequence,
        completion: lifetime.completion,
        scopeId: session.scopeId,
        // Kernel stamps the durable workId at createIntent time.
        workId: "pending",
        targetId: target.targetId,
        scheduledAtMs,
        scheduledSpanId: provisionalScheduledSpanId,
        ...(traceId ? { traceId } : {}),
      };
      const intent = await session.runtime.kernel.stageDeferredIntent({
        namespace: session.runtime.namespace,
        scopeId: session.scopeId,
        intentId: `${session.scopeId}:${sequence + 1}` as DeferredIntentId,
        leaseToken: session.lease.token,
        leaseExpiresAt: session.lease.expiresAt,
        targetId: target.targetId,
        input: acceptedInput,
        provenance: namedDeferProvenanceAsJson(provisionalProvenance),
      });
      // Prefer the durable row's span id (idempotent stage retries converge).
      const scheduledSpanId =
        isRuntimeNamedDeferProvenance(intent.provenance) &&
        typeof intent.provenance.scheduledSpanId === "string"
          ? intent.provenance.scheduledSpanId
          : provisionalScheduledSpanId;
      stagedIntents.push({
        sequence,
        scheduledAtMs,
        workId: intent.workId,
        targetId: intent.targetId,
        scopeId: session.scopeId,
      });
      // Emit public scheduled evidence only after durable acceptance succeeded.
      const stagedObservation = evidence?.onStaged({
        sequence,
        targetId: intent.targetId,
        workId: intent.workId,
        scopeId: session.scopeId,
        scheduledAtMs,
        scheduledSpanId,
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
        assertFenceHealthy(session);
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

function assertFenceHealthy(session: DurableSession): void {
  if (session.fencePoisoned === undefined) return;
  throw session.fencePoisoned;
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
