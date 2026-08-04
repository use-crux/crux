/** Durable rollback-scope lifecycle writes. @internal @module */

import { currentDurableEffectLedgerBinding } from "./durable-binding";
import type { DurableLedgerCache } from "./durable-ledger";

/** Persist one rollback-scope lifecycle transition through the store guard. */
export async function persistDurableScopeTransition(
  cache: DurableLedgerCache,
  scopeId: string,
): Promise<void> {
  const binding = currentDurableEffectLedgerBinding();
  if (!binding) return;
  const scope = requireValue(cache.getScope(scopeId), "scope");
  await binding.store.transact(async (tx) => {
    const effects = requireValue(tx.effects, "Effects store port");
    const snapshot = await effects.reconstructScope(scope.ref, {
      namespace: binding.namespace,
    });
    if (!snapshot) return;
    const next = {
      ...snapshot.scopeRecord,
      scope,
      revision: snapshot.scopeRecord.revision + 1,
    };
    if (!(await effects.transitionScope({ next }))) {
      throw new TypeError(`Durable Effect scope \`${scopeId}\` rejected its transition.`);
    }
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} is unavailable.`);
  }
  return value;
}
