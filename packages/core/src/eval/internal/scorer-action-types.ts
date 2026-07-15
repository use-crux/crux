/** Immutable planner-admitted managed external-scorer actions. @internal */

import type { Scorer } from "../../quality/scorers";
import type { EvalScorerEvidenceEntry } from "./scorer-evidence";

interface EvalScorerActionBase {
  readonly actionId: string;
  readonly dependency: "task:root";
  readonly scorerName: string;
  readonly externalKind: "model";
  readonly price: { readonly kind: "unknown" };
  readonly admission: "admitted";
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
      readonly reason: "no_exact_evidence" | "identity_unavailable";
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
