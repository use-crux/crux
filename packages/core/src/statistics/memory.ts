import { decodeOwnerState, encodeOwnerState } from "./codec";
import { assertFactCanApply } from "./fact-invariants";
import { createOwnerState, type OwnerState } from "./internal";
import { fingerprintRecord, normalizeStatisticsRecord } from "./record";
import { applyFact } from "./reduce";
import { createSnapshot } from "./snapshot";
import type {
  StatisticsLedger,
  StatisticsLedgerExport,
  StatisticsOwner,
  StatisticsRecord,
  StatisticsSnapshot,
} from "./types";

/** Create Core's process-local statistics read model. @internal */
export function createMemoryStatisticsLedger(): StatisticsLedger {
  const owners = new Map<string, OwnerState>();

  return {
    record(record: StatisticsRecord): void {
      const normalized = normalizeStatisticsRecord(record);
      const fingerprint = fingerprintRecord(normalized);
      const key = ownerKey(normalized.owner);
      const existing = owners.get(key);
      if (existing) {
        if (normalized.cursor === existing.cursor) {
          if (fingerprint === existing.lastRecordFingerprint) return;
          throw new TypeError("Statistics ledger divergent cursor reuse.");
        }
        if (normalized.cursor < existing.cursor) {
          throw new TypeError("Statistics ledger out-of-order cursor.");
        }
        if (normalized.cursor !== existing.cursor + 1) {
          throw new TypeError("Statistics ledger cursor gap.");
        }
      } else if (normalized.cursor !== 1) {
        throw new TypeError("Statistics ledger cursor gap.");
      }
      if (existing && normalized.at < existing.updatedAt) {
        throw new TypeError("Statistics ledger out-of-order timestamp.");
      }
      const state =
        existing ??
        createOwnerState(
          normalized.owner,
          normalized.at,
          normalized.cursor,
          fingerprint,
        );
      assertFactCanApply(state, normalized.fact);
      applyFact(state, normalized.fact, normalized.at);
      state.cursor = normalized.cursor;
      state.lastRecordFingerprint = fingerprint;
      owners.set(key, state);
    },

    snapshot(owner: StatisticsOwner): StatisticsSnapshot | undefined {
      const state = owners.get(ownerKey(owner));
      return state ? createSnapshot(state) : undefined;
    },

    export(owner: StatisticsOwner): StatisticsLedgerExport | undefined {
      const state = owners.get(ownerKey(owner));
      return state ? encodeOwnerState(state) : undefined;
    },

    restore(value: unknown): void {
      const decoded = decodeOwnerState(value);
      const key = ownerKey(decoded.owner);
      const current = owners.get(key);
      if (current?.cursor === decoded.cursor) {
        if (
          current.lastRecordFingerprint !== decoded.lastRecordFingerprint ||
          encodeOwnerState(current).state !== encodeOwnerState(decoded).state
        ) {
          throw new TypeError("Statistics ledger divergent cursor reuse.");
        }
        return;
      }
      if (current && current.cursor > decoded.cursor) return;
      owners.set(key, decoded);
    },
  };
}

function ownerKey(owner: StatisticsOwner): string {
  return `${owner.kind}:${owner.id}`;
}
