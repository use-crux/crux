/**
 * Runtime-scoped durable Effect ledger binding.
 *
 * @internal
 * @module
 */

import type { RuntimeStoreAdapter } from "../../runtime/store";
import { getHooks } from "../../runtime/runtime";
import {
  createScopeFacetSlot,
  currentScopeFacet,
  runWithScopeFacet,
} from "../../scope/internal";

/** Runtime store partition available to the Effect ledger. */
export interface DurableEffectLedgerBinding {
  readonly namespace: string;
  readonly store: RuntimeStoreAdapter;
}

const durableEffectLedgerSlot =
  createScopeFacetSlot<DurableEffectLedgerBinding>("effect.durable-ledger");

/** Run target code with its resolved Runtime store bound to the ledger. */
export function runWithDurableEffectLedger<T>(
  binding: DurableEffectLedgerBinding,
  run: () => T,
): T {
  return runWithScopeFacet(durableEffectLedgerSlot, binding, run);
}

/** Resolve the target-local binding, then an in-process configured Runtime. */
export function currentDurableEffectLedgerBinding():
  | DurableEffectLedgerBinding
  | undefined {
  const active = currentScopeFacet(durableEffectLedgerSlot);
  if (active?.store.effects) return active;

  const runtime = getHooks().runtimeEngine;
  if (runtime?.kind !== "in-process" || !runtime.store.effects) {
    return undefined;
  }
  return Object.freeze({
    namespace: runtime.namespace ?? "local",
    store: runtime.store,
  });
}
