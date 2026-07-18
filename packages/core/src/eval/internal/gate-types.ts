/** Portable zero-config Eval Gate outcomes. @internal */

export interface EvalGateSummary {
  readonly passed: boolean;
  readonly blockingPassed: boolean;
  readonly results: readonly EvalGateResult[];
}

export type EvalGateIncompleteReason =
  | "baseline_missing"
  | "baseline_evidence_incomplete"
  | "score_missing"
  | "score_null"
  | "score_errored"
  | "cost_missing";

export interface EvalGateResult {
  readonly gate: string;
  readonly variantName: string;
  readonly threshold: number | boolean;
  readonly actual: number | boolean;
  readonly passed: boolean;
  readonly informational?: true;
  readonly evidence?: "complete" | "incomplete";
  readonly reason?: EvalGateIncompleteReason;
  readonly remediation?: string;
}
