/**
 * Restart-safe managed-transport statistics ledger helpers.
 *
 * @module
 */

import {
  createMemoryStatisticsLedger,
  type ScopeStats,
  type StatisticsFact,
  type StatisticsLedgerExport,
  type StatisticsOwner,
  type TransportEnvelopeOutcomeStats,
  type TransportEnvelopeStats,
} from "../../statistics";
import type { RuntimeStoreAdapter } from "../store";
import { TransportStoreMissingError } from "./lifecycle-errors";

/** Stable ledger owner for one Runtime namespace's managed-transport activity. */
export function transportStatisticsOwner(namespace: string): StatisticsOwner {
  return Object.freeze({ kind: "transport", id: namespace });
}

/**
 * Adapter/transport attribution key for bounded identity coverage.
 *
 * @remarks Uses adapter and binding ids only — never event payloads or secrets.
 */
export function transportStatisticsIdentity(
  adapterId: string,
  bindingId: string,
): string {
  return `${adapterId}/${bindingId}`;
}

/** Create the first persisted ledger export for a transport owner. */
export function initialTransportStatistics(
  namespace: string,
  at: Date,
): StatisticsLedgerExport {
  const ledger = createMemoryStatisticsLedger();
  const owner = transportStatisticsOwner(namespace);
  ledger.record({
    owner,
    cursor: 1,
    at,
    fact: { kind: "timing", activeTimeMs: 0, suspendedTimeMs: 0 },
  });
  return ledger.export(owner)!;
}

/**
 * Append mechanical transport-envelope facts to a namespace ledger export.
 *
 * Commit time is nondecreasing after restore so durable appends remain ordered
 * under clock skew.
 */
export function recordTransportStatistics(
  statistics: StatisticsLedgerExport,
  namespace: string,
  at: Date,
  facts: readonly StatisticsFact[],
): StatisticsLedgerExport {
  if (facts.length === 0) {
    return statistics;
  }

  const ledger = createMemoryStatisticsLedger();
  ledger.restore(statistics);
  const owner = transportStatisticsOwner(namespace);
  const newest = ledger.snapshot(owner)?.at;
  const commitAt = newest && newest.getTime() > at.getTime() ? newest : at;
  let cursor = statistics.cursor;

  for (const fact of facts) {
    cursor += 1;
    ledger.record({ owner, cursor, at: commitAt, fact });
  }

  return ledger.export(owner)!;
}

/** Read a detached immutable transport aggregate from a ledger export. */
export function transportStatisticsFromExport(
  statistics: StatisticsLedgerExport,
  namespace: string,
): TransportEnvelopeStats {
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(statistics);
  return ledger.snapshot(transportStatisticsOwner(namespace))!.scope.transport;
}

/** Empty transport counters used when a namespace has no ledger yet. */
export function emptyTransportEnvelopeStats(): TransportEnvelopeStats {
  const total: TransportEnvelopeOutcomeStats = Object.freeze({
    accepted: 0,
    deduplicated: 0,
    normalized: 0,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
  });
  return Object.freeze({
    total,
    byIdentity: Object.freeze({}),
    identityAttribution: "complete" as const,
  });
}

/** Options for reading restart-safe transport statistics. */
export interface TransportStatisticsOptions {
  readonly store: RuntimeStoreAdapter;
  readonly namespace: string;
}

/**
 * Load bounded managed-transport statistics for one Runtime namespace.
 *
 * @remarks Returns exact totals with first-64 adapter/binding attribution.
 * Missing ledgers yield zeroed counters rather than an error.
 */
export async function transportStatistics(
  options: TransportStatisticsOptions,
): Promise<TransportEnvelopeStats> {
  const exported = await options.store.transact(async (tx) => {
    if (!tx.transports) {
      throw new TransportStoreMissingError();
    }

    return tx.transports.getStatistics(options.namespace);
  });

  if (!exported) {
    return emptyTransportEnvelopeStats();
  }

  return transportStatisticsFromExport(exported, options.namespace);
}

/** Project full scope stats when a host needs the complete ledger snapshot. */
export function transportScopeStatsFromExport(
  statistics: StatisticsLedgerExport,
  namespace: string,
): ScopeStats {
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(statistics);
  return ledger.snapshot(transportStatisticsOwner(namespace))!.scope;
}
