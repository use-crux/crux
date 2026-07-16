import type { DeployedEvalRegistry } from "../eval-registry";
import type { InMemoryRuntimeStore } from "../adapters/memory";
import type { JsonValue } from "../../storage";
import type { RuntimeResultRef } from "../results/types";

/** Stable private wire protocol spoken by deployed Eval execution hosts. */
export const CRUX_EVAL_HOST_PROTOCOL = "crux.eval-host.v1" as const;

/** Runtime substrates covered by the Eval host conformance contract. */
export type EvalHostKind =
  | "memory"
  | "node"
  | "serverless"
  | "convex"
  | "cloudflare";

/** Authenticated deployment manifest safe for coordinator preflight. */
export interface EvalHostManifestV1 {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL;
  readonly deploymentId: string;
  readonly hostKind: EvalHostKind;
  readonly capabilities: readonly string[];
  readonly resultMaxBytes: number;
  readonly evals: readonly EvalHostManifestEntryV1[];
}

/** Allowlisted identity and capability facts for one deployed Eval. */
export interface EvalHostManifestEntryV1 {
  readonly id: string;
  readonly evalFingerprint: string;
  readonly cases: Readonly<Record<string, string>>;
  readonly variants: Readonly<Record<string, string>>;
  readonly requiredHostCapabilities: readonly string[];
}

/** Construction inputs shared by the memory reference host. */
export interface CreateMemoryEvalHostOptions {
  /** Stable deployment identity compared before admission. */
  readonly deploymentId: string;
  /** Dedicated Eval-execute bearer capability. */
  readonly token: string;
  /** Generated allowlist containing executable deployed Evals. */
  readonly registry: DeployedEvalRegistry;
  /** Deterministic clock used by deadline and protocol conformance tests. */
  readonly now?: () => Date;
  /** Bounded operational limits; defaults are conservative production values. */
  readonly limits?: Readonly<{
    readonly maxConcurrentJobs?: number;
    readonly maxPollsPerSecond?: number;
  }>;
  /** Durable services this host can satisfy for managed tasks. */
  readonly hostCapabilities?: readonly string[];
}

/** Fetch-compatible private Eval host boundary. */
export interface MemoryEvalHost {
  /** Handle one authenticated manifest or job request. */
  fetch(request: Request): Promise<Response>;
  /** Reference store exposed for shared adapter conformance assertions. */
  readonly store: InMemoryRuntimeStore;
}

/** Exact deployed-Case request admitted by Eval host V1. */
export interface SubmitEvalJobV1 {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL;
  readonly jobId: string;
  readonly evalRunId: string;
  readonly evalId: string;
  readonly evalFingerprint: string;
  readonly caseId: string;
  readonly caseFingerprint: string;
  readonly variant: string;
  readonly variantFingerprint: string;
  readonly trial: number;
  readonly deadlineAt: string;
}

/** Stable non-retryable error returned by the private host protocol. */
export interface EvalHostErrorV1 {
  readonly code: string;
  readonly message: string;
  readonly retryable: false;
  readonly phase: "auth" | "admission" | "execute" | "result" | "transport";
}

interface EvalHostJobStatusBaseV1 {
  readonly jobId: string;
  readonly evalRunId: string;
  readonly attempt: number;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Durable Runtime work projection returned by job poll and reconnect. */
export type EvalHostJobStatusV1 =
  | (EvalHostJobStatusBaseV1 & { readonly status: "accepted" | "running" })
  | (EvalHostJobStatusBaseV1 & {
      readonly status: "succeeded";
      readonly resultRef: RuntimeResultRef;
      readonly result: JsonValue;
    })
  | (EvalHostJobStatusBaseV1 & {
      readonly status: "failed" | "cancelled" | "expired";
      readonly error: EvalHostErrorV1;
    });
