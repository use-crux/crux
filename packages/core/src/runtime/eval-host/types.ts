import type { DeployedEvalRegistry } from "../eval-registry";
import type { InMemoryRuntimeStore } from "../adapters/memory";
import type { JsonValue } from "../../storage";
import type { RuntimeResultRef } from "../results/types";
import type { RuntimeResultPayloadPort } from "../results/types";
import type { RuntimeStoreAdapter } from "../store";
import type { InProcessRuntimeEngineDefinition } from "../api/runtime-definition";
import type { RuntimeWakeRequestVerifier } from "../handler/verify";
import type { WorkItem } from "../engine/work";
import type { RuntimeHandlerTarget } from "../handler/targets";
import type { TimeoutBudget } from "../../generation/timeout";

/** Strict legacy wire protocol retained for decoding existing host records. */
export const CRUX_EVAL_HOST_PROTOCOL_V1 = "crux.eval-host.v1" as const;

/** Current wire protocol emitted for all newly admitted Eval host work. */
export const CRUX_EVAL_HOST_PROTOCOL_V2 = "crux.eval-host.v2" as const;

/** Current private wire protocol spoken by deployed Eval execution hosts. */
export const CRUX_EVAL_HOST_PROTOCOL = CRUX_EVAL_HOST_PROTOCOL_V2;

/** Capability proving in-flight structured timeout terminal support. */
export const EVAL_HOST_STRUCTURED_TIMEOUT_CAPABILITY = "structured-timeout";

/** Semantic identity of the current strict private result envelope. */
export const EVAL_HOST_RESULT_CODEC_VERSION = "result-codec.v2";

/** Runtime substrates covered by the Eval host conformance contract. */
export type EvalHostKind =
  | "memory"
  | "node"
  | "serverless"
  | "convex"
  | "cloudflare";

interface EvalHostManifestBase {
  readonly deploymentId: string;
  readonly hostKind: EvalHostKind;
  /** Secret-free identity of the generated persistence policy. */
  readonly privacyFingerprint: string;
  readonly capabilities: readonly string[];
  readonly resultMaxBytes: number;
  readonly evals: readonly EvalHostManifestEntryV1[];
}

/** Authenticated legacy deployment manifest retained for readiness diagnostics. */
export interface EvalHostManifestV1 extends EvalHostManifestBase {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL_V1;
}

/** Authenticated current deployment manifest safe for new remote work. */
export interface EvalHostManifestV2 extends EvalHostManifestBase {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL_V2;
}

/** Strict authenticated manifest versions understood by the coordinator. */
export type EvalHostManifest = EvalHostManifestV1 | EvalHostManifestV2;

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
  readonly job: SubmitEvalJob;
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
  /** Generated Runtime targets deployed beside the Eval executor. */
  readonly targets?: readonly RuntimeHandlerTarget[];
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

interface SubmitEvalJobIdentity {
  readonly jobId: string;
  readonly evalRunId: string;
  readonly evalId: string;
  readonly evalFingerprint: string;
  readonly caseId: string;
  readonly caseFingerprint: string;
  readonly variant: string;
  readonly variantFingerprint: string;
  readonly trial: number;
}

/** Exact deployed-Case request retained for strict V1 decoding. */
export interface SubmitEvalJobV1 extends SubmitEvalJobIdentity {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL_V1;
  readonly deadlineAt: string;
}

/** Source and relative limit that selected one V2 absolute deadline. */
export interface EvalHostDeadlineV2 {
  readonly source: "eval" | "host";
  readonly limitMs: number;
}

/** Exact deployed-Case request emitted for newly admitted V2 work. */
export interface SubmitEvalJobV2 extends SubmitEvalJobIdentity {
  readonly protocol: typeof CRUX_EVAL_HOST_PROTOCOL_V2;
  readonly deadlineAt: string;
  readonly deadline: EvalHostDeadlineV2;
}

/** Strict submission shapes understood by the current host reader. */
export type SubmitEvalJob = SubmitEvalJobV1 | SubmitEvalJobV2;

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

/** Structured timeout metadata retained by an expired V2 job. */
export interface EvalHostTimeoutV2 {
  readonly budget: TimeoutBudget;
  readonly limitMs: number;
  readonly toolName?: string;
  readonly phase: "pre_start" | "in_flight";
}

/** Durable V2 Runtime work projection returned by job poll and reconnect. */
export type EvalHostJobStatusV2 =
  | (EvalHostJobStatusBaseV1 & { readonly status: "accepted" | "running" })
  | (EvalHostJobStatusBaseV1 & {
      readonly status: "succeeded";
      readonly resultRef: RuntimeResultRef;
      readonly result: JsonValue;
    })
  | (EvalHostJobStatusBaseV1 & {
      readonly status: "failed" | "cancelled";
      readonly error: EvalHostErrorV1;
    })
  | (EvalHostJobStatusBaseV1 & {
      readonly status: "expired";
      readonly error: EvalHostErrorV1;
      readonly timeout: EvalHostTimeoutV2;
    });
