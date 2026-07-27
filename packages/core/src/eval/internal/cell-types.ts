/** Immutable task-host evidence and versioned Eval-cell records. @internal */

import type { StreamCompletion } from "../../adapter";
import type { TimeoutBudget } from "../../generation/timeout";
import type { EvalCapability } from "../task";
import type { CellAssertionOutcome } from "./assertion-types";
import type { EvalScoreEvidence } from "./score-types";
import type { EvalTaskIdentityProjection } from "./task";

export type EvalTaskNonReusableReason =
  | "identity_unavailable"
  | "model_identity_unattested"
  | "untracked_external_dependency"
  | "nondeterministic_renderer"
  | "task_binding_untracked"
  | "unresolved_source_dependency"
  | "implicit_media"
  | "registry_identity_unavailable"
  | "host_contract_unavailable";

export type EvalFreshnessSource =
  | "latency_gate"
  | "eval_expect"
  | "eval_after_scores"
  | "case_expect"
  | "case_after_scores";

/** Portable request sent to the selected Eval task host. */
export interface EvalTaskHostRequest {
  readonly evalId: string;
  readonly caseId: string;
  readonly variant: string;
  readonly trial: number;
  readonly task: unknown;
  readonly overrides: Readonly<Record<string, unknown>>;
  readonly input: unknown;
  readonly call?: Readonly<Record<string, unknown>>;
  /**
   * Unique identity for an explicitly fresh execution. Omitted for ordinary
   * work so a retry can reconnect to the same admitted host job.
   */
  readonly executionAttemptId?: string;
}

/** Reusable task evidence produced by a successful task-host invocation. */
export interface EvalTaskExecutionEvidence {
  readonly output: unknown;
  readonly response?: StreamCompletion<unknown>;
  readonly capturedSignals: readonly EvalCapability[];
  readonly runIds: readonly string[];
  readonly metrics: {
    readonly durationMs: number;
    readonly costUsd?: number;
  };
  readonly renderedPromptFingerprint?: string;
}

/** Live task evidence plus the host-observed task identity. */
export interface EvalTaskHostResult extends EvalTaskExecutionEvidence {
  readonly observedIdentity:
    | EvalTaskIdentityProjection
    | {
        readonly reusable: true;
        /** One-way identity projected by a remote execution host. */
        readonly fingerprint: string;
      };
}

export interface EvalAssertionSummary {
  readonly ran: number;
  readonly notEvaluated: number;
  readonly outcomes: readonly CellAssertionOutcome[];
}

/** Scorer name and semantic contract admitted before cell execution. */
export interface EvalScorerContract {
  readonly name: string;
  readonly contractFingerprint: string;
}

export type EvalTaskWorkDecisionV3 =
  | { readonly status: "skipped"; readonly reason: "source_skipped" }
  | {
      readonly status: "executed";
      readonly reason:
        | "live_required"
        | "fresh_requested"
        | "performance_freshness"
        | "no_exact_evidence"
        | EvalTaskNonReusableReason;
      readonly evidenceFingerprint?: string;
      readonly evidenceRef?: string;
      readonly freshnessSource?: EvalFreshnessSource;
    }
  | {
      readonly status: "reused";
      readonly reason: "exact_evidence";
      readonly evidenceFingerprint: string;
      readonly evidenceRef: string;
    }
  | { readonly status: "errored"; readonly reason: "task_error" };

export type EvalTaskWorkDecision =
  | EvalTaskWorkDecisionV3
  | { readonly status: "timed_out" };

/**
 * Canonical structured timeout evidence stored on a complete Run V4 cell.
 *
 * @remarks
 * This identifies the winning budget. It does not claim that user code was
 * forcibly terminated or that detached work stopped accruing cost.
 */
export interface EvalCellTimeout {
  readonly budget: TimeoutBudget;
  readonly limitMs: number;
  readonly toolName?: string;
}

interface EvalCellBase {
  readonly caseId: string;
  readonly caseName?: string;
  readonly variant: string;
  readonly trial: number;
  readonly skipReason?: string;
  readonly scores: readonly EvalScoreEvidence[];
  readonly assertions: EvalAssertionSummary;
  readonly input: unknown;
  readonly call?: Readonly<Record<string, unknown>>;
  readonly output?: unknown;
  readonly expected?: unknown;
  readonly unvalidatedExpected?: true;
  readonly response?: StreamCompletion<unknown>;
  /** Persisted runs omit unsafe or oversized responses; the trace remains linked by runIds. */
  readonly responseOmitted?: "persistence_size_limit" | "persistence_unsafe";
  readonly error?: {
    readonly message: string;
    readonly phase: "execute" | "expect" | "afterScores" | "score";
  };
  readonly metrics: { readonly durationMs: number; readonly costUsd?: number };
  readonly runIds: readonly string[];
  readonly capturedSignals: readonly EvalCapability[];
}

type NonTimedOutCell = EvalCellBase & {
  readonly status: "passed" | "failed" | "errored" | "skipped";
  readonly task: EvalTaskWorkDecisionV3;
  readonly timeout?: never;
};

/** Closed cell shape retained by the legacy Run V3 reader. */
export type EvalCellV3 = NonTimedOutCell & {
  readonly scorerContracts?: never;
};

/**
 * Current Run V4 cell shape with exact timeout-dependent fields.
 *
 * A `timed_out` cell is complete and non-passing, has a matching task status,
 * and carries structured timeout evidence instead of a generic task error.
 */
export type EvalCellV4 = (
  | NonTimedOutCell
  | (Omit<EvalCellBase, "error"> & {
      readonly status: "timed_out";
      readonly task: { readonly status: "timed_out" };
      readonly timeout: EvalCellTimeout;
      readonly error?: never;
    })
) & {
  /** Exact per-cell scorer catalog admitted by the immutable plan. */
  readonly scorerContracts: readonly EvalScorerContract[];
};

/** Current live cell projection produced by the Eval kernel. */
export type EvalCell = EvalCellV4;
