export interface EvalBaselineRecord {
  readonly schemaVersion: 3;
  readonly baselineId: string;
  readonly evalId: string;
  readonly runId: string;
  readonly selectedArm: string;
  readonly promotedAt: number;
  readonly promotedBy?: string;
  readonly toolVersion: string;
  readonly coverage: readonly {
    readonly caseId: string;
    readonly trials: readonly number[];
    readonly metrics: Readonly<
      Record<
        string,
        {
          readonly contractFingerprint: string;
          readonly values: readonly {
            readonly trial: number;
            readonly value: number | null;
            readonly label?: string;
          }[];
        }
      >
    >;
  }[];
  readonly warnings?: readonly {
    readonly code: string;
    readonly message: string;
  }[];
  readonly provenance: {
    readonly definitionFingerprint: string;
    readonly taskFingerprint: string;
  };
  readonly baselineCompatibility: {
    readonly status: "compatible" | "incompatible" | "unknown";
    readonly reason?: string;
    readonly currentDefinitionFingerprint?: string;
    readonly baselineDefinitionFingerprint?: string;
    readonly variant?: {
      readonly name: string;
      readonly status: "compatible" | "missing";
      readonly reason?: string;
    };
    readonly cases: readonly {
      readonly caseId: string;
      readonly status: "compatible" | "missing" | "incompatible" | "unknown";
      readonly reason?: string;
      readonly metrics: readonly {
        readonly name: string;
        readonly status: "compatible" | "missing" | "incompatible" | "unknown";
        readonly reason?: string;
      }[];
    }[];
    readonly currentOnlyCases?: readonly string[];
  };
}
