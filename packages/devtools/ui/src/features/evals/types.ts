export interface EvalCatalogEntry {
  readonly id: string;
  readonly sourceKey: { readonly relativeFile: string };
  readonly cases: readonly {
    readonly id: string;
    readonly unvalidatedExpected?: true;
  }[];
  readonly variants: readonly string[];
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly caseFiles?: readonly string[];
}

export interface EvalRunRecord {
  readonly schemaVersion: 3;
  readonly runId: string;
  readonly evalId: string;
  readonly status: "complete" | "incomplete";
  readonly passed: boolean;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly selection: {
    readonly filtered?: true;
  };
  readonly cells: readonly {
    readonly caseId: string;
    readonly variant: string;
    readonly status: string;
    readonly task: { readonly status: string; readonly reuseReason?: string };
  }[];
  readonly aggregates?: Readonly<
    Record<
      string,
      {
        readonly passRate: number;
        readonly latencyMs: number;
        readonly knownCostUsd?: number;
      }
    >
  >;
  readonly gates?: {
    readonly passed: boolean;
    readonly results: readonly {
      readonly gate: string;
      readonly variantName: string;
      readonly passed: boolean;
      readonly actual: number | boolean;
      readonly threshold: number | boolean;
    }[];
  };
  readonly cost?: {
    readonly actualUsd?: number;
    readonly reservedMaximumUsd: number;
    readonly unknownActionCount: number;
  };
  readonly reasons?: readonly string[];
}

export interface SetEvalBaselineResult {
  readonly runId: string;
  readonly path: string;
}
