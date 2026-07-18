export interface EvalCatalogEntry {
  readonly id: string;
  readonly definitionFingerprint: string;
  readonly sourceKey: { readonly relativeFile: string };
  readonly cases: readonly {
    readonly id: string;
    readonly unvalidatedExpected?: true;
  }[];
  readonly variants: readonly string[];
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly caseFiles?: readonly string[];
  readonly requiredHostCapabilities?: readonly string[];
  readonly hostReadiness?: EvalCatalogHostReadiness;
}

export type EvalCatalogHostReadiness =
  | {
      readonly status: "ready";
      readonly mode: "local" | "deployed";
      readonly deploymentId?: string;
      readonly hostKind?: string;
    }
  | {
      readonly status: "setup-required" | "unverified";
      readonly reason: string;
      readonly remedies: readonly string[];
      readonly deploymentId?: string;
      readonly hostKind?: string;
    }
  | {
      readonly status: "mismatch";
      readonly reason: string;
      readonly remedy: string;
      readonly deploymentId?: string;
      readonly hostKind?: string;
    };

export type EvalTaskWork =
  | {
      readonly status: "executed";
      readonly reason:
        | "live_required"
        | "fresh_requested"
        | "performance_freshness"
        | "no_exact_evidence"
        | "identity_unavailable"
        | "model_identity_unattested"
        | "untracked_external_dependency"
        | "nondeterministic_renderer"
        | "task_binding_untracked"
        | "unresolved_source_dependency"
        | "implicit_media"
        | "registry_identity_unavailable"
        | "host_contract_unavailable";
      readonly evidenceRef?: string;
    }
  | {
      readonly status: "reused";
      readonly reason: "exact_evidence";
      readonly evidenceRef: string;
    }
  | { readonly status: "errored"; readonly reason: "task_error" }
  | { readonly status: "skipped"; readonly reason: "source_skipped" };

export interface EvalRunRecord {
  readonly schemaVersion: 3;
  readonly runId: string;
  readonly evalId: string;
  readonly sourceKey: {
    readonly relativeFile: string;
    readonly export: "default";
  };
  readonly definitionFingerprint: string;
  readonly status: "complete" | "incomplete";
  readonly passed: boolean;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly selection: {
    readonly filtered?: true;
  };
  readonly cells: readonly {
    readonly caseId: string;
    readonly caseName?: string;
    readonly variant: string;
    readonly trial?: number;
    readonly status: string;
    readonly task: EvalTaskWork;
    readonly scores?: readonly {
      readonly status: "computed" | "reused" | "missing" | "errored";
      readonly reason: string;
      readonly name: string;
      readonly value?: number | null;
      readonly label?: string;
      readonly rationale?: string;
      readonly message?: string;
      readonly metrics?: {
        readonly actualUsd?: number;
        readonly usage?: {
          readonly inputTokens: number;
          readonly outputTokens: number;
          readonly totalTokens: number;
        };
      };
      readonly work?: {
        readonly status: "executed" | "reused" | "not_called" | "errored";
        readonly reason: string;
        readonly evidenceRef?: string;
        readonly reservation: "consumed" | "released";
      };
    }[];
    readonly assertions?: {
      readonly ran: number;
      readonly notEvaluated: number;
      readonly outcomes: readonly {
        readonly id: string;
        readonly status: string;
        readonly matcher: string;
        readonly message?: string;
        readonly expression?: { readonly rendered: string };
      }[];
    };
    readonly input?: unknown;
    readonly call?: unknown;
    readonly output?: unknown;
    readonly expected?: unknown;
    readonly response?: unknown;
    readonly error?: { readonly message: string; readonly phase: string };
    readonly metrics?: {
      readonly durationMs: number;
      readonly costUsd?: number;
    };
    readonly runIds?: readonly string[];
    readonly capturedSignals?: readonly string[];
  }[];
  readonly variants?: readonly {
    readonly name: string;
    readonly fingerprint: string;
    readonly overrideKeys: readonly string[];
    readonly blocking: boolean;
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
    readonly task: { readonly actualUsd?: number };
    readonly judge: { readonly actualUsd?: number };
  };
  readonly reasons?: readonly string[];
  readonly comparison?: {
    readonly baselineId: string;
    readonly baselineRunId: string;
    readonly selectedArm: string;
    readonly cases: readonly {
      readonly caseId: string;
      readonly status: "compatible" | "missing" | "incompatible";
      readonly reason?: string;
      readonly metrics: readonly (
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
          }
      )[];
    }[];
  };
}

export interface SetEvalBaselineResult {
  readonly runId: string;
  readonly path: string;
}

export interface RunEvalResult {
  readonly evalId: string;
  readonly runId: string;
  readonly runIds: readonly string[];
  readonly exitCode: 0 | 1;
  readonly passed: boolean;
}
