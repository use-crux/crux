/** Portable persisted Eval Baseline and granular comparison records. @internal */

import type { EvalSourceKey } from "./types";
import type { BASELINE_FINGERPRINT_EPOCH } from "./evidence/cache-epochs";

export interface EvalBaselineMetricValue {
  readonly trial: number;
  readonly value: number | null;
  readonly label?: string;
}

export interface EvalBaselineMetric {
  readonly contractFingerprint: string;
  readonly aggregation: "arithmetic_mean_non_null_v1";
  readonly values: readonly EvalBaselineMetricValue[];
}

/** Terminal result aligned to one promoted Case trial. */
export interface EvalBaselineTrialOutcome {
  readonly trial: number;
  readonly status: "passed" | "failed" | "timed_out";
}

export interface EvalBaselineCase {
  readonly caseId: string;
  readonly inputFingerprint: string;
  readonly callFingerprint: string;
  readonly expectedFingerprint: string;
  readonly trials: readonly number[];
  readonly outcomes: readonly EvalBaselineTrialOutcome[];
  readonly metrics: Readonly<Record<string, EvalBaselineMetric>>;
}

export interface EvalBaselineV3 {
  readonly schemaVersion: 3;
  readonly baselineFingerprintEpoch: typeof BASELINE_FINGERPRINT_EPOCH;
  readonly baselineId: string;
  readonly evalId: string;
  readonly runId: string;
  readonly selectedArm: string;
  readonly sourceKey: EvalSourceKey;
  readonly promotedAt: number;
  readonly promotedBy?: string;
  readonly toolVersion: string;
  readonly coverage: readonly EvalBaselineCase[];
  readonly skippedCases?: readonly {
    readonly caseId: string;
    readonly reason: string;
  }[];
  readonly provenance: {
    readonly definitionFingerprint: string;
    readonly taskFingerprint: string;
  };
  readonly warnings?: readonly {
    readonly code: "promoted_failing_run";
    readonly message: string;
  }[];
  readonly snapshotFingerprint: string;
}

export type EvalBaselineMetricComparison =
  | {
      readonly name: string;
      readonly status: "compatible";
      readonly baseline: number | null;
      readonly candidate: number | null;
      readonly delta: number | null;
    }
  | {
      readonly name: string;
      readonly status: "missing" | "incompatible";
      readonly reason: string;
    };

export interface EvalBaselineCaseComparison {
  readonly caseId: string;
  readonly status: "compatible" | "missing" | "incompatible";
  readonly reason?: string;
  readonly metrics: readonly EvalBaselineMetricComparison[];
}

export interface EvalBaselineComparison {
  readonly baselineId: string;
  readonly baselineRunId: string;
  readonly selectedArm: string;
  readonly cases: readonly EvalBaselineCaseComparison[];
  readonly unmatchedCases: {
    readonly baselineOnly: readonly string[];
    readonly candidateOnly: readonly string[];
  };
}

export type EvalBaselineContractStatus =
  | "compatible"
  | "missing"
  | "incompatible"
  | "unknown";

export interface EvalBaselineDefinitionCompatibility {
  readonly status: "compatible" | "incompatible" | "unknown";
  readonly reason?: string;
  readonly currentDefinitionFingerprint: string;
  readonly baselineDefinitionFingerprint: string;
  readonly variant: {
    readonly name: string;
    readonly status: "compatible" | "missing";
    readonly reason?: string;
  };
  readonly cases: readonly {
    readonly caseId: string;
    readonly status: EvalBaselineContractStatus;
    readonly reason?: string;
    readonly metrics: readonly {
      readonly name: string;
      readonly status: EvalBaselineContractStatus;
      readonly reason?: string;
    }[];
  }[];
  readonly currentOnlyCases: readonly string[];
}
