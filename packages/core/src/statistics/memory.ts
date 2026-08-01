import { createOwnerState, type OwnerState } from "./internal";
import { applyFact } from "./reduce";
import { createSnapshot } from "./snapshot";
import type {
  StatisticsLedger,
  StatisticsLedgerExport,
  StatisticsOwner,
  StatisticsRecord,
  StatisticsSnapshot,
} from "./types";

/** Create a zero-configuration, process-local statistics ledger. */
export function createMemoryStatisticsLedger(): StatisticsLedger {
  const owners = new Map<string, OwnerState>();

  return {
    record(record: StatisticsRecord): void {
      const key = ownerKey(record.owner);
      const existing = owners.get(key);
      if (existing && record.cursor <= existing.cursor) return;
      const state =
        existing ?? createOwnerState(record.owner, record.at, record.cursor);
      owners.set(key, state);
      state.cursor = record.cursor;
      applyFact(state, record.fact, record.at);
    },

    snapshot(owner: StatisticsOwner): StatisticsSnapshot | undefined {
      const state = owners.get(ownerKey(owner));
      return state ? createSnapshot(state) : undefined;
    },

    export(owner: StatisticsOwner): StatisticsLedgerExport | undefined {
      const state = owners.get(ownerKey(owner));
      return state ? encodeOwnerState(state) : undefined;
    },

    restore(value: StatisticsLedgerExport): void {
      const key = ownerKey(value.owner);
      const current = owners.get(key);
      if (current && current.cursor >= value.cursor) return;
      owners.set(key, decodeOwnerState(value));
    },
  };
}

function ownerKey(owner: StatisticsOwner): string {
  return `${owner.kind}:${owner.id}`;
}
import { decodeOwnerState, encodeOwnerState } from "./codec";
