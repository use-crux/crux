import type {
  FailureKind,
  ScopeStats,
  StatisticsUsageReport,
  WorkCurrentState,
} from "./aggregates";

export type * from "./aggregates";

/** Stable identity for one statistics-owning execution scope. @internal */
export interface StatisticsOwner {
  /** Kind of execution scope that owns the aggregate. */
  readonly kind: "run" | "flow" | "session" | "composition" | "work" | "media";
  /** Stable owner identifier within its kind. */
  readonly id: string;
}

/**
 * One normalized mechanical execution fact accepted by a statistics ledger.
 *
 * Facts intentionally have no fields for messages, model output, Tool
 * arguments/results, media, URLs, error messages, or raw activity events.
 * @internal
 */
export type StatisticsFact =
  | {
      readonly kind: "model-call";
      readonly outcome: "started" | "succeeded" | "failed" | "cancelled";
      /** Normalized model identity, never a request identity. */
      readonly model: string;
      /** Provider-normalized usage accompanying a terminal outcome. */
      readonly usage?: StatisticsUsageReport;
    }
  | {
      readonly kind: "transport-retry";
      /** Normalized model identity from the sealed semantic plan. */
      readonly model: string;
      /** Provider-normalized usage physically incurred by this retry. */
      readonly usage?: StatisticsUsageReport;
    }
  | {
      readonly kind: "tool";
      /** Registered Tool identity. */
      readonly name: string;
      readonly outcome:
        | "called"
        | "succeeded"
        | "failed"
        | "denied"
        | "cancelled";
    }
  | {
      readonly kind: "work-accepted";
      /** Normalized child target identity, never a Work id. */
      readonly target: string;
      /** Initial nonterminal state of the accepted logical Work. */
      readonly state: Exclude<WorkCurrentState, "suspended">;
    }
  | {
      readonly kind: "work-state";
      /** Normalized child target identity, never a Work id. */
      readonly target: string;
      readonly from: WorkCurrentState;
      readonly to: WorkCurrentState;
    }
  | {
      readonly kind: "work-outcome";
      /** Normalized child target identity, never a Work id. */
      readonly target: string;
      readonly from: WorkCurrentState;
      readonly outcome: "completed" | "failed" | "cancelled" | "detached";
    }
  | { readonly kind: "failure"; readonly failureKind: FailureKind }
  | {
      readonly kind: "approval";
      readonly outcome: "requested" | "approved" | "denied" | "expired";
    }
  | {
      readonly kind: "lifecycle";
      readonly event:
        | "suspension"
        | "resumption"
        | "cancellation"
        | "steering-input";
    }
  | {
      readonly kind: "timing";
      /** Active duration newly committed by this fact. */
      readonly activeTimeMs: number;
      /** Suspended duration newly committed by this fact. */
      readonly suspendedTimeMs: number;
      /** Whether this fact also commits owner completion. */
      readonly completed?: boolean;
    };

/** Input used to commit one ordered fact to an owner aggregate. @internal */
export interface StatisticsRecord {
  /** Owner receiving this fact and no other owner's facts. */
  readonly owner: StatisticsOwner;
  /** Monotonic committed activity position used for replay idempotency. */
  readonly cursor: number;
  /** Commit timestamp for timing and snapshot freshness. */
  readonly at: Date;
  /** Content-free mechanical fact to aggregate. */
  readonly fact: StatisticsFact;
}

/** Immutable point-in-time view of one owner's committed aggregate. @internal */
export interface StatisticsSnapshot {
  /** Addressed owner whose identity remains stable while totals grow. */
  readonly owner: StatisticsOwner;
  /** Timestamp of the newest included fact. */
  readonly at: Date;
  /** Greatest committed activity position included in this snapshot. */
  readonly cursor: number;
  /** Complete mechanical aggregate through {@link cursor}. */
  readonly scope: ScopeStats;
}

/**
 * Versioned, JSON-safe state for one statistics owner.
 *
 * Durable hosts may persist this value and later pass it to
 * {@link StatisticsLedger.restore}. Its `state` payload is opaque to hosts and
 * contains only Core's content-free aggregate state.
 * @internal
 */
export interface StatisticsLedgerExport {
  /** Export format version understood by Core. */
  readonly version: 1;
  /** Owner addressed by this export. */
  readonly owner: StatisticsOwner;
  /** Greatest committed activity position retained by this export. */
  readonly cursor: number;
  /** Opaque JSON string that hosts must persist unchanged. */
  readonly state: string;
}

/**
 * Provider-neutral port for owner-scoped execution statistics.
 *
 * The port is synchronous because it owns only the incremental read model.
 * Durable hosts persist {@link StatisticsLedgerExport} values through their
 * existing lifecycle and storage contracts.
 * @internal
 */
export interface StatisticsLedger {
  /** Commit one mechanical fact in activity-cursor order. */
  record(record: StatisticsRecord): void;
  /** Read a detached immutable snapshot, or `undefined` for an unknown owner. */
  snapshot(owner: StatisticsOwner): StatisticsSnapshot | undefined;
  /** Export one owner's JSON-safe state for host-managed persistence. */
  export(owner: StatisticsOwner): StatisticsLedgerExport | undefined;
  /** Restore validated persisted input without replacing newer local state. */
  restore(value: unknown): void;
}
