import type { RuntimePruneResult } from "../ports/retention";
import type { RuntimeStoreAdapter } from "../store";
import type { ResolvedRuntimeRetentionConfig } from "./retention";

/** Dependencies for pruning retained runtime records during maintenance. */
export interface KernelRetentionMaintenanceDeps {
  readonly store: RuntimeStoreAdapter;
  readonly retention: ResolvedRuntimeRetentionConfig;
}

/** Prune terminal runtime records owned by the kernel retention policy. */
export async function pruneRetainedRecords(
  deps: KernelRetentionMaintenanceDeps,
  options: {
    readonly namespace?: string;
    readonly now: Date;
  },
): Promise<RuntimePruneResult> {
  if (!options.namespace) return { removed: 0, truncated: false };

  const retention = deps.retention;
  const namespace = options.namespace;
  const limit = retention.sweepLimit;
  const resultStore = deps.store.results;
  const effectStore = deps.store.effects;
  const results = await Promise.all([
    pruneIfEnabled(retention.events, options.now, (before) =>
      deps.store.events.prune({ namespace: options.namespace, before, limit }),
    ),
    pruneIfEnabled(retention.terminalWork, options.now, (before) =>
      deps.store.state.pruneTerminalWork({
        namespace: options.namespace,
        before,
        limit,
      }),
    ),
    pruneIfEnabled(retention.terminalSnapshots, options.now, (before) =>
      deps.store.state.pruneTerminalSnapshots({
        namespace: options.namespace,
        before,
        limit,
      }),
    ),
    pruneIfEnabled(retention.confirmedOutbox, options.now, (before) =>
      deps.store.outbox.prune({ namespace: options.namespace, before, limit }),
    ),
    pruneIfEnabled(retention.idempotencyKeys, options.now, (before) =>
      deps.store.state.pruneIdempotencyKeys({
        namespace: options.namespace,
        before,
        limit,
      }),
    ),
    pruneIfEnabled(retention.settledTimers, options.now, (before) =>
      deps.store.timers.prune({ namespace: options.namespace, before, limit }),
    ),
    pruneIfEnabled(retention.settledWaiters, options.now, (before) =>
      deps.store.waiters.prune({ namespace: options.namespace, before, limit }),
    ),
    resultStore
      ? pruneIfEnabled(retention.terminalWork, options.now, (before) =>
          resultStore.pruneUnreferenced({
            namespace,
            before,
            limit,
          }),
        )
      : { removed: 0, truncated: false },
    effectStore
      ? pruneIfEnabled(retention.effectEnvelopes, options.now, (before) =>
          deps.store.transact(async (tx) =>
            tx.effects!.prune({ namespace, before, now: options.now, limit }),
          ),
        )
      : { removed: 0, truncated: false },
  ]);

  return results.reduce(
    (total, result) => ({
      removed: total.removed + result.removed,
      truncated: total.truncated || result.truncated,
    }),
    { removed: 0, truncated: false },
  );
}

function cutoff(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() - ttlMs);
}

async function pruneIfEnabled(
  ttlMs: number | false,
  now: Date,
  prune: (before: Date) => Promise<RuntimePruneResult>,
): Promise<RuntimePruneResult> {
  if (ttlMs === false) return { removed: 0, truncated: false };
  return await prune(cutoff(now, ttlMs));
}
