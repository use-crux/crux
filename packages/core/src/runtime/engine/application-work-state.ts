/** Durable safe read-model state attached to an application Work row. */

import type { StatisticsLedgerExport } from "../../statistics";
import type { EffectScopeRef } from "../../effect";
import { initialApplicationWorkStatistics } from "./application-work-statistics";
import type { RuntimeWorkItem } from "./work";

/** Persisted latest progress value for one application Work occurrence. */
export interface RuntimeApplicationWorkProgress {
  readonly message?: string;
  readonly current?: number;
  readonly total?: number;
  readonly updatedAt: string;
}

/** Persisted ownership relation for one application Work occurrence. */
export type RuntimeApplicationWorkOwnership =
  | { readonly state: "attached" }
  | {
      readonly state: "detached";
      readonly reason: "explicit" | "owner-ended";
      readonly detachedAt: string;
    };

/** Bounded public metadata retained on the canonical Runtime Work row. */
export interface RuntimeApplicationWorkState {
  readonly schemaVersion: 1;
  /** Time of the latest public Work state, progress, or ownership update. */
  readonly updatedAt: string;
  readonly progress?: RuntimeApplicationWorkProgress;
  readonly ownership: RuntimeApplicationWorkOwnership;
  /** Stable Effect scope allocated with this canonical Work occurrence. */
  readonly effects?: EffectScopeRef;
  /** Time of the first transition into running execution. */
  readonly startedAt?: string;
  /** Safe bounded reason retained after cooperative cancellation. */
  readonly cancellationReason?: string;
  /** Existing statistics-ledger export persisted losslessly by the host. */
  readonly statistics?: StatisticsLedgerExport;
  /** Cursor of the newest safe public Work event. */
  readonly latestEventCursor?: string;
}

/** Create the initial safe application metadata for accepted Work. */
export function initialApplicationWorkState(
  workId: string,
  acceptedAt: Date,
  effects?: EffectScopeRef,
): RuntimeApplicationWorkState {
  return Object.freeze({
    schemaVersion: 1,
    updatedAt: acceptedAt.toISOString(),
    ownership: Object.freeze({ state: "attached" }),
    ...(effects ? { effects: Object.freeze({ ...effects }) } : {}),
    statistics: initialApplicationWorkStatistics(workId, acceptedAt),
  });
}

/** Return whether a public Work occurrence reached its final boundary. */
export function isApplicationWorkTerminal(work: RuntimeWorkItem): boolean {
  return (
    work.status === "completed" ||
    work.status === "cancelled" ||
    work.status === "dead-letter"
  );
}
