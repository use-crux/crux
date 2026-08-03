/** Owner-scoped statistics ledger persistence for application Work rows. */

import {
  createMemoryStatisticsLedger,
  type ScopeStats,
  type StatisticsFact,
  type StatisticsLedgerExport,
  type StatisticsOwner,
} from "../../statistics";
import type { RuntimeApplicationWorkState } from "./application-work-state";
import type { RuntimeWorkState } from "./work";
import type { RuntimeWorkItem } from "./work";

/** Create the first restart-safe ledger export for one accepted Work owner. */
export function initialApplicationWorkStatistics(
  workId: string,
  acceptedAt: Date,
): StatisticsLedgerExport {
  const ledger = createMemoryStatisticsLedger();
  ledger.record({
    owner: statisticsOwner(workId),
    cursor: 1,
    at: acceptedAt,
    fact: { kind: "timing", activeTimeMs: 0, suspendedTimeMs: 0 },
  });
  return ledger.export(statisticsOwner(workId))!;
}

/** Reduce ordered mechanical facts into the row's bounded ledger export. */
export function recordApplicationWorkStatistics(
  application: RuntimeApplicationWorkState,
  workId: string,
  acceptedAt: Date,
  at: Date,
  facts: readonly StatisticsFact[],
): RuntimeApplicationWorkState {
  if (facts.length === 0) return application;
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(
    application.statistics ??
      initialApplicationWorkStatistics(workId, acceptedAt),
  );
  const owner = statisticsOwner(workId);
  let cursor = ledger.export(owner)!.cursor;
  for (const fact of facts) {
    cursor += 1;
    ledger.record({ owner, cursor, at, fact });
  }
  return Object.freeze({ ...application, statistics: ledger.export(owner)! });
}

/** Read the canonical bounded ledger projection for one Work owner. */
export function applicationWorkStatistics(
  application: RuntimeApplicationWorkState | undefined,
  workId: string,
  acceptedAt: Date,
): ScopeStats {
  const ledger = createMemoryStatisticsLedger();
  ledger.restore(
    application?.statistics ??
      initialApplicationWorkStatistics(workId, acceptedAt),
  );
  return ledger.snapshot(statisticsOwner(workId))!.scope;
}

/** Account elapsed time since the preceding Work-row update. */
export function applicationWorkTimingFact(
  state: RuntimeWorkState,
  previousAt: Date,
  at: Date,
  completed = false,
): StatisticsFact {
  const elapsed = Math.max(0, at.getTime() - previousAt.getTime());
  return {
    kind: "timing",
    activeTimeMs: state === "suspended" ? 0 : elapsed,
    suspendedTimeMs: state === "suspended" ? elapsed : 0,
    ...(completed ? { completed: true } : {}),
  };
}

/** Carry the ledger export across one canonical Runtime lifecycle transition. */
export function recordApplicationWorkTransition(
  previous: RuntimeWorkItem,
  next: RuntimeWorkItem,
  at: Date,
  options: {
    readonly completed?: boolean;
    readonly facts?: readonly StatisticsFact[];
  } = {},
): RuntimeWorkItem {
  if (!previous.application) return next;
  const application = recordApplicationWorkStatistics(
    previous.application,
    previous.workId,
    previous.createdAt,
    at,
    [
      ...(options.facts ?? []),
      applicationWorkTimingFact(
        previous.status,
        applicationUpdatedAt(previous),
        at,
        options.completed,
      ),
    ],
  );
  return Object.freeze({
    ...next,
    application: Object.freeze({ ...application, updatedAt: at.toISOString() }),
    updatedAt: at,
  });
}

/** Return the last public accounting boundary for one application Work row. */
export function applicationUpdatedAt(work: RuntimeWorkItem): Date {
  return new Date(work.application?.updatedAt ?? work.updatedAt);
}

function statisticsOwner(workId: string): StatisticsOwner {
  return Object.freeze({ kind: "work", id: workId });
}
