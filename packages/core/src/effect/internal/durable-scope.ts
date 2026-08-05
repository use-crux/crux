/** Durable rollback-scope lifecycle writes. @internal @module */

import { currentDurableEffectLedgerBinding } from "./durable-binding";
import type { DurableLedgerCache } from "./durable-ledger";
import { durableUnitRecord } from "./durable-record-builders";

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
    const durableUnitIds = new Set(
      snapshot?.units.map((record) => record.unit.id) ?? [],
    );
    const missingUnits = scope.unitIds.flatMap((unitId) => {
      if (durableUnitIds.has(unitId)) return [];
      const unit = cache.getUnit(unitId);
      if (!unit) return [];
      const appendOrder = cache.stackFor(scopeId).findIndex((entry) =>
        entry.kind === "boundary"
          ? entry.unitId === unitId
          : unit.receiptIds.includes(entry.receiptId),
      );
      return [durableUnitRecord(
        binding.namespace,
        unit,
        1,
        1,
        appendOrder < 0 ? undefined : appendOrder + 1,
      )];
    });
    if (!snapshot && missingUnits.length === 0) return;
    if (
      snapshot &&
      missingUnits.length === 0 &&
      snapshot.scopeRecord.scope.status === scope.status &&
      snapshot.scopeRecord.scope.parentId === scope.parentId &&
      snapshot.scopeRecord.scope.unitIds.length === scope.unitIds.length &&
      snapshot.scopeRecord.scope.unitIds.every(
        (unitId, index) => unitId === scope.unitIds[index],
      )
    ) return;
    const next = {
      ...(snapshot?.scopeRecord ?? { namespace: binding.namespace }),
      scope,
      revision: (snapshot?.scopeRecord.revision ?? 0) + 1,
    };
    const accepted = missingUnits.length > 0
      ? await effects.synchronizeScope({ scope: next, units: missingUnits })
      : await effects.transitionScope({ next });
    if (!accepted) {
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
