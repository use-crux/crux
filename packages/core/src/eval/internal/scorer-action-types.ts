/** Immutable planner-admitted managed external-scorer actions. @internal */

import type { Scorer } from "./scorers/types";
import type { ScorerEvidenceDependency } from "./scorers/runtime";
import type { EvalScorerEvidenceEntry } from "./scorer-evidence";

interface EvalScorerActionBase {
  readonly actionId: string;
  readonly dependency: "task:root";
  readonly scorerName: string;
  readonly occurrence: string;
  /** Exact evidence dimensions declared by the managed scorer runtime. */
  readonly dependencies: readonly ScorerEvidenceDependency[];
  readonly externalKind: "model";
  readonly price: { readonly kind: "unknown" };
  readonly admission: "admitted";
  /** Whether exact scorer evidence may be consulted for this action. */
  readonly evidenceRead: "allow" | "bypass";
  readonly evidenceReadReason?: "fresh_requested" | "performance_freshness";
}

export type EvalScorerAction =
  | (EvalScorerActionBase & {
      readonly kind: "after_task_output";
      readonly scorer: Scorer<unknown, unknown, unknown>;
      readonly contractFingerprint?: string;
      readonly hostContractFingerprint?: string;
      readonly reason: "output_dependency";
      readonly reservation: {
        readonly kind: "reserved";
        readonly reservationId: string;
      };
    })
  | (EvalScorerActionBase & {
      readonly kind: "execute";
      readonly scorer: Scorer<unknown, unknown, unknown>;
      readonly contractFingerprint?: string;
      readonly hostContractFingerprint?: string;
      readonly evidenceKey?: string;
      readonly reason:
        | "fresh_requested"
        | "performance_freshness"
        | "no_exact_evidence"
        | "identity_unavailable";
      readonly reservation: {
        readonly kind: "reserved";
        readonly reservationId: string;
      };
    })
  | (EvalScorerActionBase & {
      readonly kind: "reuse";
      readonly contractFingerprint: string;
      readonly hostContractFingerprint: string;
      readonly reason: "exact_evidence";
      readonly reservation: { readonly kind: "released" };
      readonly evidence: EvalScorerEvidenceEntry;
    });
