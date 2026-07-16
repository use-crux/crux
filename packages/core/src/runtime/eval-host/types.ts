import type { DeployedEvalRegistry } from "../eval-registry";
import type { InMemoryRuntimeStore } from "../adapters/memory";
import type { JsonValue } from "../../storage";
import type { RuntimeResultRef } from "../results/types";
import type { RuntimeResultPayloadPort } from "../results/types";
import type { RuntimeStoreAdapter } from "../store";
import type { InProcessRuntimeEngineDefinition } from "../api/runtime-definition";
import type { RuntimeWakeRequestVerifier } from "../handler/verify";
import type { WorkItem } from "../engine/work";

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

/** Runtime store whose result capability is proven before Eval admission. */
export type EvalHostStore = RuntimeStoreAdapter & {
  readonly results: RuntimeResultPayloadPort;
  /** Optional adapter-native atomic Eval admission operation. */
  readonly evalHost?: EvalHostAdmissionPort;
};

/** Adapter-native atomic admission input for stores with remote transactions. */
export interface EvalHostAdmissionInput {
  readonly namespace: string;
  readonly workId: string;
  readonly job: SubmitEvalJobV1;
  readonly maxConcurrentJobs: number;
  readonly now: Date;
}

/** Atomic Eval admission result returned by a durable host adapter. */
export type EvalHostAdmissionResult =
  | { readonly kind: "capacity" }
  | {
      readonly kind: "admitted";
      readonly work: WorkItem;
      readonly created: boolean;
    };

/** Adapter-native admission capability used when callbacks cannot cross transactions. */
export interface EvalHostAdmissionPort {
  admit(input: EvalHostAdmissionInput): Promise<EvalHostAdmissionResult>;
}

/** Shared authenticated Eval-host construction contract. */
export interface CreateEvalHostOptions {
  /** Stable deployment identity compared before admission. */
  readonly deploymentId: string;
  /** Dedicated Eval-execute bearer capability. */
  readonly token: string;
  /** Generated allowlist containing executable deployed Evals. */
  readonly registry: DeployedEvalRegistry;
  /** Deterministic clock used by deadline and protocol conformance tests. */
  readonly now?: () => Date;
  /** Bounded operational limits. */
  readonly limits?: CreateMemoryEvalHostOptions["limits"];
  /** Durable services this host can satisfy for managed tasks. */
  readonly hostCapabilities?: readonly string[];
}

/** Options for a long-lived in-process Node Eval host. */
export interface CreateNodeEvalHostOptions extends CreateEvalHostOptions {
  /** Optional result-capable store; defaults to the process-local memory store. */
  readonly store?: EvalHostStore;
}

/** Options for a durable generic-serverless Eval host invocation. */
export interface CreateServerlessEvalHostOptions<
  TStore extends EvalHostStore = EvalHostStore,
> extends CreateEvalHostOptions {
  /** Existing serverless composer definition with durable state and wake ports. */
  readonly runtime: InProcessRuntimeEngineDefinition<TStore>;
  /** Explicit wake verifier override for trusted adapter bridges. */
  readonly verifyWake?: RuntimeWakeRequestVerifier;
}

/** Fetch-compatible authenticated Eval protocol handler. */
export interface EvalHostFetchHandler {
  /** Handle one manifest or job request. */
  fetch(request: Request): Promise<Response>;
}

/** Generic-serverless handler pair for Eval traffic and signed wake delivery. */
export interface ServerlessEvalHost<
  TStore extends EvalHostStore = EvalHostStore,
> extends EvalHostFetchHandler {
  /** Durable store retained across invocation reconstruction. */
  readonly store: TStore;
  /** Handle one signed Runtime wake request. */
  wake(request: Request): Promise<Response>;
  /** Stop invocation-owned maintenance resources. */
  dispose(): void;
}

/** Fetch-compatible private Eval host boundary. */
export interface MemoryEvalHost extends EvalHostFetchHandler {
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
