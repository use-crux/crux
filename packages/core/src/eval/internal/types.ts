/** Portable immutable plan records for the Eval kernel. @internal */

import type { EvalTaskEvidenceEntry } from "./evidence";
import type { EvalScorerAction } from "./scorer-action-types";
import type { NormalizedEvalCheck } from "./definition";
import type { EvalCostPlan } from "./cost-types";
import type { EvalPlanPreflight } from "./offline-types";
import type { ResolvedEvalTimeoutPolicy } from "../timeout-policy";
import type {
  EvalFreshnessSource,
  EvalScorerContract,
  EvalTaskNonReusableReason,
} from "./cell-types";
import type { Scorer } from "./scorers/types";

export type { EvalScorerAction } from "./scorer-action-types";
export type { EvalGateResult, EvalGateSummary } from "./gate-types";
export type { EvalScoreEvidence } from "./score-types";
export type {
  EvalAssertionSummary,
  EvalCell,
  EvalCellTimeout,
  EvalCellV3,
  EvalCellV4,
  EvalFreshnessSource,
  EvalScorerContract,
  EvalTaskExecutionEvidence,
  EvalTaskHostRequest,
  EvalTaskHostResult,
  EvalTaskNonReusableReason,
  EvalTaskWorkDecision,
  EvalTaskWorkDecisionV3,
} from "./cell-types";
export type {
  EvalRun,
  EvalRunComplete,
  EvalRunIncomplete,
  EvalRunV3,
  EvalRunV4,
  EvalRunVariant,
  EvalVariantAggregate,
  EvalVariantAggregateV3,
  EvalVariantAggregateV4,
} from "./run-types";

export interface EvalSourceKey {
  readonly relativeFile: string;
  readonly export: "default";
}

export interface EvalSelection {
  readonly cases: readonly string[];
  readonly variants: readonly string[];
  readonly trials: number;
  /** Exact authored trial count for each selected Case. */
  readonly caseTrials: Readonly<Record<string, number>>;
  /** Present only when Case selection omitted authored work. */
  readonly filtered?: true;
}

export interface EvalPlannedArm {
  readonly name: string;
  readonly task: unknown;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly overrideKeys: readonly string[];
  readonly fingerprint: string;
  readonly blocking: boolean;
}

export type EvalPlanAction =
  | {
      readonly kind: "skip";
      readonly reason: "source_skipped";
      readonly detail?: string;
    }
  | {
      readonly kind: "execute";
      readonly reason:
        | "live_required"
        | "fresh_requested"
        | "performance_freshness"
        | "no_exact_evidence"
        | EvalTaskNonReusableReason;
      readonly evidenceKey?: string;
      readonly plannedAdapterFingerprint?: string;
      readonly freshnessSource?: EvalFreshnessSource;
    }
  | {
      readonly kind: "reuse";
      readonly reason: "exact_evidence";
      readonly evidence: EvalTaskEvidenceEntry;
    };

export interface EvalPlannedCell {
  readonly caseId: string;
  readonly caseName?: string;
  readonly variant: string;
  readonly trial: number;
  readonly blocking: boolean;
  readonly task: unknown;
  /** Frozen outer deadline and privately marked nested timeout ceiling. */
  readonly timeout: ResolvedEvalTimeoutPolicy;
  /** Frozen managed capabilities projected during cell planning. */
  readonly requiredHostCapabilities: readonly string[];
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly action: EvalPlanAction;
  /** Scorers resolved and admitted for this exact cell without invocation. */
  readonly scorers: readonly Scorer<unknown, unknown, unknown>[];
  /** Frozen catalog projected from the exact admitted scorer bindings. */
  readonly scorerContracts: readonly EvalScorerContract[];
  readonly scorerActions: readonly EvalScorerAction[];
  readonly input: unknown;
  readonly call?: Readonly<Record<string, unknown>>;
  readonly expected?: unknown;
  readonly unvalidatedExpected?: true;
  readonly expect?: NormalizedEvalCheck;
  readonly afterScores?: NormalizedEvalCheck;
}

/** One live cell whose declared capabilities require the selected Runtime. */
export interface EvalRequiredHostWork {
  readonly caseId: string;
  readonly variant: string;
  readonly trial: number;
  readonly capabilities: readonly string[];
}

/** Pre-spend proof that remaining task work can use its required execution host. */
export type EvalHostReadiness =
  | {
      readonly status: "local";
      readonly reason: "no_required_host_work" | "exact_evidence";
    }
  | {
      readonly status: "verified";
      readonly deploymentId: string;
      readonly hostKind: string;
    }
  | {
      readonly status: "unverified";
      readonly reason: "offline" | "connection_unavailable" | "transport";
      readonly remedies: readonly string[];
    }
  | {
      readonly status: "mismatch";
      readonly reason: string;
      readonly remedy: string;
    };

export interface EvalPlan {
  readonly schemaVersion: 1;
  readonly evalId: string;
  readonly sourceKey: EvalSourceKey;
  readonly definitionFingerprint: string;
  readonly selection: EvalSelection;
  /** Diagnostic placement proof resolved after exact evidence lookup. */
  readonly hostReadiness: EvalHostReadiness;
  readonly preflight: EvalPlanPreflight;
  readonly cost: EvalCostPlan;
  readonly task: unknown;
  readonly arms: readonly EvalPlannedArm[];
  readonly expect?: NormalizedEvalCheck;
  readonly afterScores?: NormalizedEvalCheck;
  readonly scorers: unknown;
  readonly gates?: unknown;
  readonly scorerActions: readonly EvalScorerAction[];
  readonly cells: readonly EvalPlannedCell[];
}
