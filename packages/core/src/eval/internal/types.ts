/** Portable immutable plan and run records for the Eval kernel. @internal */

import type { StreamCompletion } from "../../adapter";
import type { CellAssertionOutcome } from "../../quality/experiment";
import type { EvalCapability } from "../task";
import type { EvalTaskEvidenceEntry } from "./evidence";
import type { EvalTaskIdentityProjection } from "./task";
import type { EvalScorerAction } from "./scorer-action-types";
import type { EvalGateSummary } from "./gate-types";

export type { EvalScorerAction } from "./scorer-action-types";
export type { EvalGateResult, EvalGateSummary } from "./gate-types";

export type EvalTaskNonReusableReason =
  | "identity_unavailable"
  | "untracked_external_dependency"
  | "implicit_media"
  | "registry_identity_unavailable"
  | "host_contract_unavailable";

export interface EvalSourceKey {
  readonly relativeFile: string;
  readonly export: "default";
}

export interface EvalSelection {
  readonly cases: readonly string[];
  readonly variants: readonly string[];
  readonly trials: number;
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
      readonly kind: "execute";
      readonly reason:
        | "live_required"
        | "no_exact_evidence"
        | EvalTaskNonReusableReason;
      readonly evidenceKey?: string;
      readonly plannedAdapterFingerprint?: string;
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
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly action: EvalPlanAction;
  readonly scorerActions: readonly EvalScorerAction[];
  readonly input: Readonly<Record<string, unknown>>;
  readonly call?: Readonly<Record<string, unknown>>;
  readonly expected?: unknown;
  readonly expect?: unknown;
}

export interface EvalPlan {
  readonly schemaVersion: 1;
  readonly evalId: string;
  readonly sourceKey: EvalSourceKey;
  readonly definitionFingerprint: string;
  readonly selection: EvalSelection;
  readonly task: unknown;
  readonly arms: readonly EvalPlannedArm[];
  readonly expect?: unknown;
  readonly scorers: unknown;
  readonly scorerActions: readonly EvalScorerAction[];
  readonly cells: readonly EvalPlannedCell[];
}

export interface EvalTaskHostRequest {
  readonly evalId: string;
  readonly caseId: string;
  readonly variant: string;
  readonly trial: number;
  readonly task: unknown;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly input: Readonly<Record<string, unknown>>;
  readonly call?: Readonly<Record<string, unknown>>;
}

export interface EvalTaskExecutionEvidence {
  readonly output: unknown;
  readonly response: StreamCompletion<unknown>;
  readonly capturedSignals: readonly EvalCapability[];
  readonly runIds: readonly string[];
  readonly metrics: {
    readonly durationMs: number;
    readonly costUsd?: number;
  };
}

export interface EvalTaskHostResult extends EvalTaskExecutionEvidence {
  readonly observedIdentity: EvalTaskIdentityProjection;
}

export interface EvalAssertionSummary {
  readonly ran: number;
  readonly notEvaluated: number;
  readonly outcomes: readonly CellAssertionOutcome[];
}

export type EvalScoreEvidence =
  | {
      readonly status: "computed";
      readonly reason: "deterministic_local";
      readonly name: string;
      readonly contractFingerprint: "local_always_run";
      readonly value: number | null;
      readonly label?: string;
      readonly rationale?: string;
    }
  | {
      readonly status: "errored";
      readonly reason: "scorer_error";
      readonly name: string;
      readonly contractFingerprint: "local_always_run";
      readonly message: string;
    }
  | {
      readonly status: "computed";
      readonly reason: "managed_external_executed" | "managed_external_reused";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly value: number | null;
      readonly label?: string;
      readonly rationale?: string;
      readonly work: {
        readonly status: "executed" | "reused";
        readonly reason:
          | "no_exact_evidence"
          | "identity_unavailable"
          | "exact_evidence";
        readonly evidenceRef?: string;
        readonly reservation: "consumed" | "released";
      };
    }
  | {
      readonly status: "errored";
      readonly reason: "scorer_error" | "dependency_failed";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly message: string;
      readonly work: {
        readonly status: "errored" | "not_called";
        readonly reason: "scorer_error" | "dependency_failed";
        readonly reservation: "consumed" | "released";
      };
    };

export type EvalTaskWorkDecision =
  | {
      readonly status: "executed";
      readonly reason:
        | "live_required"
        | "no_exact_evidence"
        | EvalTaskNonReusableReason;
      readonly evidenceFingerprint?: string;
      readonly evidenceRef?: string;
    }
  | {
      readonly status: "reused";
      readonly reason: "exact_evidence";
      readonly evidenceFingerprint: string;
      readonly evidenceRef: string;
    }
  | { readonly status: "errored"; readonly reason: "task_error" };

export interface EvalCell {
  readonly caseId: string;
  readonly caseName?: string;
  readonly variant: string;
  readonly trial: number;
  readonly status: "passed" | "failed" | "errored";
  readonly task: EvalTaskWorkDecision;
  readonly scores: readonly EvalScoreEvidence[];
  readonly assertions: EvalAssertionSummary;
  readonly input: Readonly<Record<string, unknown>>;
  readonly call?: Readonly<Record<string, unknown>>;
  readonly output?: unknown;
  readonly expected?: unknown;
  readonly response?: StreamCompletion<unknown>;
  readonly error?: {
    readonly message: string;
    readonly phase: "execute" | "expect" | "score";
  };
  readonly metrics: { readonly durationMs: number; readonly costUsd?: number };
  readonly runIds: readonly string[];
  readonly capturedSignals: readonly EvalCapability[];
}

export interface EvalRunVariant {
  readonly name: string;
  readonly fingerprint: string;
  readonly overrideKeys: readonly string[];
  readonly blocking: boolean;
}

export interface EvalVariantAggregate {
  readonly cells: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly skipped: 0;
  readonly passRate: number;
  readonly scores: Readonly<
    Record<
      string,
      { readonly mean: number; readonly sem: number; readonly n: number }
    >
  >;
  readonly trialConsistency: number;
  readonly latencyMs: number;
  readonly knownCostUsd?: number;
}

interface EvalRunBase {
  readonly schemaVersion: 3;
  readonly runId: string;
  readonly evalId: string;
  readonly sourceKey: EvalSourceKey;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly definitionFingerprint: string;
  readonly selection: EvalSelection;
  readonly costControl: "not_required";
  readonly blockingVariants: readonly string[];
  readonly cells: readonly EvalCell[];
  readonly variants: readonly EvalRunVariant[];
  readonly aggregates: Readonly<Record<string, EvalVariantAggregate>>;
  readonly gates: EvalGateSummary;
  readonly cost: {
    readonly actualUsd?: number;
    readonly reservedMaximumUsd: 0;
    readonly unknownActionCount: 0;
    readonly task: { readonly actualUsd?: number };
    readonly judge: { readonly actualUsd: 0 };
  };
  readonly provenance: {
    readonly task: "managed";
    readonly host: "injected";
    readonly evidenceStore:
      | "none"
      | {
          readonly identity: string;
          readonly consistency: "read_after_write" | "eventual";
          readonly write:
            | "written"
            | "failed"
            | "not_eligible"
            | "not_attempted";
          readonly writeReason?:
            | "identity_unavailable"
            | "untracked_external_dependency"
            | "implicit_media"
            | "observed_identity_mismatch";
        };
  };
}

export interface EvalRunComplete extends EvalRunBase {
  readonly status: "complete";
  readonly passed: boolean;
}

export interface EvalRunIncomplete extends EvalRunBase {
  readonly status: "incomplete";
  readonly passed: false;
  readonly reasons: readonly (
    | "task_error"
    | "assertion_error"
    | "scorer_error"
  )[];
}

export type EvalRun = EvalRunComplete | EvalRunIncomplete;
