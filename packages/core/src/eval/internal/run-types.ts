/** Versioned immutable Eval Run read models. @internal */

import type { EvalBaselineComparison } from "./baseline-types";
import type { EvalCellV3, EvalCellV4 } from "./cell-types";
import type { EvalGateSummary } from "./gate-types";
import type { EvalSelection, EvalSourceKey } from "./types";

export interface EvalRunVariant<VariantName extends string = string> {
  readonly name: "current" | VariantName;
  readonly fingerprint: string;
  readonly overrideKeys: readonly string[];
  readonly blocking: boolean;
}

interface EvalVariantAggregateBase<ScoreName extends string = string> {
  readonly cells: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: number;
  readonly passRate: number;
  readonly scores: Readonly<
    Partial<
      Record<
        ScoreName,
        { readonly mean: number; readonly sem: number; readonly n: number }
      >
    >
  >;
  readonly trialConsistency: number;
  readonly latencyMs: number;
  readonly knownCostUsd?: number;
}

/** Aggregate retained by the legacy V3 reader. */
export type EvalVariantAggregateV3<ScoreName extends string = string> =
  EvalVariantAggregateBase<ScoreName> & {
    readonly timedOut?: never;
  };

/** Current V4 aggregate; active cells include timed-out cells. */
export type EvalVariantAggregateV4<ScoreName extends string = string> =
  EvalVariantAggregateBase<ScoreName> & {
    readonly timedOut: number;
  };

/** Current aggregate produced by the Eval kernel. */
export type EvalVariantAggregate<ScoreName extends string = string> =
  | EvalVariantAggregateV3<ScoreName>
  | EvalVariantAggregateV4<ScoreName>;

type EvidenceStoreProvenance =
  | "none"
  | {
      readonly identity: string;
      readonly consistency: "read_after_write" | "eventual";
      readonly write: "written" | "failed" | "not_eligible" | "not_attempted";
      readonly writeReason?:
        | "identity_unavailable"
        | "task_binding_untracked"
        | "model_identity_unattested"
        | "untracked_external_dependency"
        | "unresolved_source_dependency"
        | "implicit_media"
        | "capture_policy"
        | "observed_identity_mismatch";
    };

interface EvalRunBase<
  Version extends 3 | 4,
  Cell,
  Aggregate,
  VariantName extends string,
> {
  readonly schemaVersion: Version;
  readonly runId: string;
  readonly evalId: string;
  readonly sourceKey: EvalSourceKey;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly definitionFingerprint: string;
  readonly selection: EvalSelection;
  readonly costControl: "not_required" | "max_cost" | "unknown";
  readonly blockingVariants: readonly string[];
  readonly cells: readonly Cell[];
  readonly variants: readonly EvalRunVariant<VariantName>[];
  readonly aggregates: Readonly<
    Partial<Record<"current" | VariantName, Aggregate>>
  >;
  readonly comparison?: EvalBaselineComparison;
  readonly gates: EvalGateSummary;
  readonly cost: {
    readonly actualUsd?: number;
    readonly reservedMaximumUsd: number;
    readonly unknownActionCount: number;
    readonly task: { readonly actualUsd?: number };
    readonly judge: { readonly actualUsd?: number };
  };
  readonly provenance: {
    readonly task: "managed" | "opaque";
    readonly host: "injected";
    readonly evidenceStore: EvidenceStoreProvenance;
  };
}

type IncompleteReason =
  | "task_error"
  | "assertion_error"
  | "scorer_error"
  | "baseline_missing"
  | "baseline_evidence_incomplete"
  | "score_missing"
  | "score_null"
  | "score_errored"
  | "cost_missing";

type TerminalRun<Base> =
  | (Base & {
      readonly status: "complete";
      readonly passed: boolean;
    })
  | (Base & {
      readonly status: "incomplete";
      readonly passed: false;
      readonly reasons: readonly IncompleteReason[];
    });

/** Exact legacy Run V3 shape accepted only by retained readers. */
export type EvalRunV3<
  ScoreName extends string = string,
  VariantName extends string = string,
> = TerminalRun<
  EvalRunBase<3, EvalCellV3, EvalVariantAggregateV3<ScoreName>, VariantName>
>;

/**
 * Exact current Run V4 shape emitted by the Eval kernel.
 *
 * Run V4 adds complete `timed_out` cells and `timedOut` aggregate counts.
 * Compatibility readers continue to accept persisted Run V3 records.
 */
export type EvalRunV4<
  ScoreName extends string = string,
  VariantName extends string = string,
> = TerminalRun<
  EvalRunBase<4, EvalCellV4, EvalVariantAggregateV4<ScoreName>, VariantName>
>;

/** Persisted Run union accepted by compatibility readers and stores. */
export type EvalRun<
  ScoreName extends string = string,
  VariantName extends string = string,
> = EvalRunV3<ScoreName, VariantName> | EvalRunV4<ScoreName, VariantName>;

export type EvalRunComplete<
  ScoreName extends string = string,
  VariantName extends string = string,
> = Extract<EvalRun<ScoreName, VariantName>, { readonly status: "complete" }>;

export type EvalRunIncomplete<
  ScoreName extends string = string,
  VariantName extends string = string,
> = Extract<EvalRun<ScoreName, VariantName>, { readonly status: "incomplete" }>;
