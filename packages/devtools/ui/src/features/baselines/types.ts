export interface EvalBaselineRecord {
  readonly schemaVersion: 3;
  readonly baselineId: string;
  readonly evalId: string;
  readonly runId: string;
  readonly selectedArm: string;
  readonly promotedAt: number;
  readonly compatibility?: {
    readonly status: string;
    readonly reasons?: readonly string[];
  };
}
