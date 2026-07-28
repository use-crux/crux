import type {
  BoundaryDef,
  BoundaryIdOf,
  MediaPartLocation,
  OriginlessBoundaryOf,
  OriginOf,
  SafetyTargetId,
} from "./boundary";
import type { ModelInputOrigin } from "./input-origin";
import type { ToolDefinitionOrigin } from "./input-tool-boundary";

/** Safe, structured finding metadata emitted by safety policies. */
export interface SafetyFinding {
  /** Stable finding kind used by audit and Devtools projections. */
  readonly type: string;
  /** Number of equivalent occurrences represented by this finding. */
  readonly count?: number;
  /** Optional zero-based source span for text findings. */
  readonly span?: { readonly start: number; readonly end: number };
  /** Stable classifier category ID; descriptions are never retained. */
  readonly category?: string;
  /** Validated normalized classifier confidence in the range `[0, 1]`. */
  readonly score?: number;
  /** Effective normalized threshold applied to `score`. */
  readonly threshold?: number;
}

/** Canonical action vocabulary for the safety decision read model. */
export type SafetyDecisionAction =
  | "allow"
  | "block"
  | "warn"
  | "rewrite"
  | "strip"
  | "retry"
  | "request_approval"
  | "drop";

/** Safe evidence summary for content touched by safety. */
export interface SafetyCaptureSummary {
  readonly level: "full" | "safe" | "evidence" | "off";
  readonly sizeBytes: number;
  readonly hash: string;
  readonly preview?: string;
  readonly raw?: string;
}

/** Canonical runtime record for a safety policy decision. */
export interface SafetyDecision {
  readonly policyId: string;
  readonly kind: "guardrail" | "constraint" | "toolPolicy";
  readonly boundary: SafetyTargetId;
  /** Privacy-safe semantic provenance for model-ingress decisions. */
  readonly origin?: ModelInputOrigin | ToolDefinitionOrigin;
  readonly stage?: "stream.segment" | "stream.final";
  readonly mode: "enforce" | "report";
  readonly action: SafetyDecisionAction;
  readonly severity?: "info" | "warn" | "error";
  readonly reason?: string;
  /** Safe model id for this media decision, when one is known. */
  readonly model?: string;
  /** Safe original coordinates for a media-boundary decision. */
  readonly location?: MediaPartLocation;
  /** Present only when an enforced strip could not preserve a required invariant. */
  readonly escalatedToBlock?: true;
  readonly findings?: readonly SafetyFinding[];
  readonly tuned?: readonly ("mode" | "enabled")[];
  readonly durationMs: number;
  readonly captured: SafetyCaptureSummary;
}

/** Mutable finding collector exposed to a single policy invocation. */
export interface SafetyFindingCollector {
  add(finding: SafetyFinding): void;
}

/** Safe provenance for one bounded-media Safety occurrence. */
export interface SafetyStreamMediaContext {
  readonly phase: "preview" | "final";
  readonly outputIndex: number;
  readonly sequence?: number;
}

/** Safe metadata available to guardrail and constraint callbacks. */
interface SafetyRunContextBase<B extends BoundaryDef | readonly BoundaryDef[]> {
  readonly policy: {
    readonly id: string;
    readonly mode: "enforce" | "report";
  };
  readonly boundary: {
    readonly id: BoundaryIdOf<B>;
    readonly kind: BoundaryIdOf<B>;
  };
  readonly prompt: {
    readonly id?: string;
  };
  readonly model: {
    readonly id?: string;
  };
  readonly trace: {
    readonly id?: string;
  };
  readonly attempt: {
    readonly index: number;
    readonly kind: "initial" | "retry";
  };
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly findings: SafetyFindingCollector;
  readonly stream?: {
    readonly segment: true;
    readonly last: boolean;
    readonly heldChars: number;
    readonly heldMs: number;
    /** Present only for bounded-media preview or final evaluation. */
    readonly media?: SafetyStreamMediaContext;
  };
  readonly path?: string;
  readonly tool?: {
    readonly name: string;
  };
}

type SafetyRunOrigin<B extends BoundaryDef | readonly BoundaryDef[]> = [
  OriginOf<B>,
] extends [never]
  ? { readonly origin?: never }
  : [OriginlessBoundaryOf<B>] extends [never]
    ? { readonly origin: OriginOf<B> }
    : { readonly origin?: OriginOf<B> };

/**
 * Safe metadata available to guardrail and constraint callbacks.
 *
 * Model-ingress boundaries expose a typed `origin`. It is required when every
 * selected boundary has semantic ingress provenance and optional for mixed
 * input/output boundary tuples.
 */
export type SafetyRunContext<
  B extends BoundaryDef | readonly BoundaryDef[] = BoundaryDef,
> = SafetyRunContextBase<B> & SafetyRunOrigin<B>;

/** Inspectable strategy callback used by first-party helpers. */
export interface StrategyRun<TSubject, TResult> {
  (subject: TSubject, ctx: SafetyRunContext): TResult | Promise<TResult>;
  readonly strategy: {
    readonly kind: string;
    readonly config: Readonly<Record<string, unknown>>;
  };
}

/** Effective posture fields that may be tuned per call. */
export interface SafetyEffectivePolicyOptions {
  readonly mode: "enforce" | "report";
  readonly enabled: boolean;
  readonly tuned?: readonly ("mode" | "enabled")[];
}
