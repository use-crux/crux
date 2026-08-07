/** Bounded statistics-ledger persistence for one durable Session lifetime. */

import {
  createMemoryStatisticsLedger,
  type ScopeStats,
  type StatisticsFact,
  type StatisticsLedgerExport,
  type StatisticsOwner,
} from "../../statistics";

/** Create the first persisted ledger export for a Session owner. */
export function initialSessionStatistics(
  sessionId: string,
  createdAt: Date,
): StatisticsLedgerExport {
  const ledger = createMemoryStatisticsLedger();
  const owner = sessionStatisticsOwner(sessionId);
  ledger.record({
    owner,
    cursor: 1,
    at: createdAt,
    fact: { kind: "timing", activeTimeMs: 0, suspendedTimeMs: 0 },
  });
  return ledger.export(owner)!;
}

/**
 * Append idempotently selected mechanical facts to a Session ledger export.
 *
 * Commit time is the later of `at` and the restored ledger's newest timestamp
 * so durable appends stay nondecreasing under clock skew after restore. Cursor
 * and fact identity semantics are unchanged; event chronology is preserved
 * elsewhere by callers.
 */
export function recordSessionStatistics(
  statistics: StatisticsLedgerExport,
  sessionId: string,
  at: Date,
  facts: readonly StatisticsFact[],
): StatisticsLedgerExport {
  if (facts.length === 0) return statistics;
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(statistics);
  const owner = sessionStatisticsOwner(sessionId);
  const newest = ledger.snapshot(owner)?.at;
  const commitAt =
    newest && newest.getTime() > at.getTime() ? newest : at;
  let cursor = statistics.cursor;
  for (const fact of facts) {
    cursor += 1;
    ledger.record({ owner, cursor, at: commitAt, fact });
  }
  return ledger.export(owner)!;
}

/** Read a detached immutable public aggregate from persisted Session state. */
export function sessionStatistics(
  statistics: StatisticsLedgerExport,
  sessionId: string,
): ScopeStats {
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(statistics);
  return ledger.snapshot(sessionStatisticsOwner(sessionId))!.scope;
}

function sessionStatisticsOwner(sessionId: string): StatisticsOwner {
  return Object.freeze({ kind: "session", id: sessionId });
}
