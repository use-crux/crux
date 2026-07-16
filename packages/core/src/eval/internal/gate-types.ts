/** Portable zero-config Eval Gate outcomes. @internal */

export interface EvalGateSummary {
  readonly passed: boolean;
  readonly blockingPassed: boolean;
  readonly results: readonly EvalGateResult[];
}

export interface EvalGateResult {
  readonly gate: "pass";
  readonly variantName: string;
  readonly threshold: true;
  readonly actual: boolean;
  readonly passed: boolean;
  readonly informational?: true;
}
