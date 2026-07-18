/** Portable per-cell score evidence and work provenance. @internal */

import type { TokenUsage } from "../../generation/types";

export type EvalScoreEvidence =
  | {
      readonly status: "computed";
      readonly reason: "deterministic_local";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly value: number | null;
      readonly label?: string;
      readonly rationale?: string;
    }
  | {
      readonly status: "errored";
      readonly reason: "scorer_error";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly message: string;
    }
  | {
      readonly status: "computed";
      readonly reason: "managed_external_executed";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly value: number | null;
      readonly label?: string;
      readonly rationale?: string;
      readonly metrics?: {
        readonly actualUsd?: number;
        readonly usage?: TokenUsage;
      };
      readonly work: {
        readonly status: "executed";
        readonly reason:
          | "fresh_requested"
          | "performance_freshness"
          | "no_exact_evidence"
          | "identity_unavailable"
          | "exact_evidence";
        readonly evidenceRef?: string;
        readonly reservation: "consumed" | "released";
      };
    }
  | {
      readonly status: "reused";
      readonly reason: "managed_external_reused";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly value: number | null;
      readonly label?: string;
      readonly rationale?: string;
      readonly work: {
        readonly status: "reused";
        readonly reason: "exact_evidence";
        readonly evidenceRef?: string;
        readonly reservation: "released";
      };
    }
  | {
      readonly status: "missing";
      readonly reason: "dependency_failed";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly message: string;
      readonly work: {
        readonly status: "not_called";
        readonly reason: "dependency_failed";
        readonly reservation: "released";
      };
    }
  | {
      readonly status: "errored";
      readonly reason: "scorer_error";
      readonly name: string;
      readonly contractFingerprint: string;
      readonly message: string;
      readonly work: {
        readonly status: "errored" | "not_called";
        readonly reason: "scorer_error";
        readonly reservation: "consumed" | "released";
      };
    };
