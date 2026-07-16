/** Portable persisted Eval Baseline and granular comparison records. @internal */

import type { EvalSourceKey } from "./types";

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

export interface EvalBaselineCase {
  readonly caseId: string;
  readonly inputFingerprint: string;
  readonly callFingerprint: string;
  readonly expectedFingerprint: string;
  readonly trials: readonly number[];
  readonly metrics: Readonly<Record<string, EvalBaselineMetric>>;
}

export interface EvalBaselineV3 {
  readonly schemaVersion: 3;
  readonly baselineFingerprintEpoch: 2;
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
