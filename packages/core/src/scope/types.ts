/** Execution boundary kinds understood by the Core scope kernel. */
export type ScopeKind =
  | "invocation"
  | "agent-turn"
  | "adapter-call"
  | "flow-step"
  | "tool"
  | "safety-session"
  | "bridge-run"
  | "eval-run"
  | "eval-cell";

/** Source location associated with an authored execution boundary. */
export interface ScopeSourceRef {
  readonly file: string;
  readonly line?: number;
  readonly definitionId?: string;
}

/** Stable identity and optional authored metadata for one execution boundary. */
export interface ScopeDescriptor {
  readonly kind: ScopeKind;
  readonly id: string;
  readonly name?: string;
  readonly sourceRef?: ScopeSourceRef;
}

export type ScopeDrainPolicy = "execute" | "capture" | "suppress";
export type ScopeSealedWritePolicy = "drop" | "reroute" | "throw";
export type ScopeEvidencePolicy = "public" | "diagnostics-only";

/** Effective bounds for deferred work retained by a host binding. */
export interface DeferLifetimeLimits {
  readonly maxDrainMs: number;
  readonly maxCallbacks: number;
  readonly concurrency: number;
  readonly maxNestingDepth: number;
}

/** Lazy unit of root work handed to the kernel retention gate. */
export interface ScopeRetainedTask {
  run(): Promise<void>;
  cancel(reason?: unknown): void;
}

/** Provider-neutral capability that retains one invocation root. */
export interface CruxHostBinding {
  readonly kind: "node" | "next" | "vercel" | "workers" | (string & {});
  /** Whether this binding may contribute ambient invocation scopes. */
  readonly invocationScope: boolean;
  /** Retain the single kernel callback that starts gated work and awaits idle. */
  retain(work: () => Promise<void>): void;
  readonly durableFinalization?: boolean;
  readonly supportsInline?: boolean;
  readonly limits?: DeferLifetimeLimits;
}

/** Policy overrides applied when a scope opens. */
export interface ScopePolicies {
  readonly drain?: ScopeDrainPolicy;
  readonly sealedWrites?: ScopeSealedWritePolicy;
  readonly evidence?: ScopeEvidencePolicy;
}

export type ScopeState = "open" | "closing" | "sealed";
export type ScopeSealedReason = "closed" | "error" | "timeout" | "cancelled";

/** Settlement vocabulary shared with existing defer invocation boundaries. */
export type ScopeOutcome =
  | "success"
  | "error"
  | "redirect"
  | "not-found"
  | "cancelled";
