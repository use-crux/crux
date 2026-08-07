/** Worker-owned drain for interrupted durable Effect rollback. @internal @module */

import { effectLedger } from "../../effect/internal/ledger";
import { runWithDurableEffectLedger } from "../../effect/internal/durable-binding";
import { runRollback } from "../../effect/internal/run-rollback";
import { persistDurableEffectScopeTransition } from "../../effect/internal/ledger-durable";
import type { RuntimeProgram } from "../program";
import type { RuntimeStoreAdapter } from "../store";

const DEFAULT_RECOVERY_CLAIM_LIMIT = 16;
const DEFAULT_RECOVERY_LEASE_MS = 30_000;
let recoveryClaimSequence = 0;

export interface WorkerEffectRecoveryDrain {
  runOnce(signal?: AbortSignal): Promise<void>;
}

/** Create the recovery pass used by the existing Runtime worker loop. */
export function createWorkerEffectRecoveryDrain(options: {
  readonly program: RuntimeProgram;
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
}): WorkerEffectRecoveryDrain | undefined {
  if (!options.store.effects) return undefined;
  return Object.freeze({
    async runOnce(signal?: AbortSignal): Promise<void> {
      const now = new Date();
      const leaseToken = createRecoveryClaimToken(now);
      const claims = await options.store.transact((tx) =>
        requireEffects(tx.effects).claimRecoveryScopes({
          namespace: options.namespace,
          now,
          limit: DEFAULT_RECOVERY_CLAIM_LIMIT,
          leaseMs: DEFAULT_RECOVERY_LEASE_MS,
          leaseToken,
        }),
      );
      for (const claim of claims) {
        const binding = Object.freeze({
          namespace: options.namespace,
          store: options.store,
          program: options.program,
          fenceToken: claim.leaseToken,
        });
        try {
          if (signal?.aborted) continue;
          await runWithDurableEffectLedger(binding, async () => {
            effectLedger.restoreDurableSnapshot(claim.snapshot, binding);
            const execution = await runRollback(
              claim.scope,
              signal ? { signal } : undefined,
              claim.snapshot,
            );
            if (execution.result.status === "cancelled") return;
            const scope = effectLedger.getScope(claim.scope.id);
            if (!scope) throw new TypeError("Claimed durable Effect scope is unavailable.");
            effectLedger.registerScope({ ...scope, status: "completed" });
            await persistDurableEffectScopeTransition(claim.scope.id);
          });
        } finally {
          await options.store.transact((tx) =>
            requireEffects(tx.effects).releaseRecoveryScope({
              namespace: options.namespace,
              scope: claim.scope,
              leaseToken: claim.leaseToken,
              now: new Date(),
            }),
          );
        }
      }
    },
  });
}

function requireEffects(
  effects: RuntimeStoreAdapter["effects"],
): NonNullable<RuntimeStoreAdapter["effects"]> {
  if (!effects) throw new TypeError("Runtime Effects store is unavailable.");
  return effects;
}

function createRecoveryClaimToken(now: Date): string {
  recoveryClaimSequence += 1;
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `effect-recovery:${now.getTime().toString(36)}:${random}:${recoveryClaimSequence.toString(36)}`;
}
