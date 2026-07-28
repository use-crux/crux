import type { MediaPartLocation, SafetyTargetId } from "../boundary";
import type { SafetyFinding } from "../decision";
import type { ModelInputOrigin } from "../input-origin";
import type { ToolDefinitionOrigin } from "../input-tool-boundary";

/** Enforcement posture for one guardrail. */
export type GuardrailMode = "enforce" | "report";

/** Privacy-safe provenance supported by guardrail runtime records. @internal */
export type GuardrailOrigin = ModelInputOrigin | ToolDefinitionOrigin;

/** Privacy-safe runtime evidence for one guardrail evaluation. */
export interface GuardrailAuditEntry {
  readonly guard: string;
  readonly category?: string;
  /** Exact boundary evaluated for this entry. */
  readonly boundary: SafetyTargetId;
  /** Privacy-safe semantic provenance for model-ingress evaluations. */
  readonly origin?: GuardrailOrigin;
  /** Effective enforcement posture after per-call tuning. */
  readonly mode: GuardrailMode;
  readonly phase: "input" | "output";
  readonly action: string;
  readonly reason?: string;
  /** Safe model id for this media evaluation, when one is known. */
  readonly model?: string;
  /** Safe original coordinates for media-boundary entries. */
  readonly location?: MediaPartLocation;
  /** Present only when stripping the part immediately became a terminal block. */
  readonly escalatedToBlock?: true;
  /** Present only when an enforced transcript rewrite removed segments and words. */
  readonly timedTranscriptDetailRemoved?: true;
  /** Validated evidence emitted by this exact policy invocation. */
  readonly findings?: readonly SafetyFinding[];
  readonly durationMs: number;
}

/** Aggregate guardrail evidence for one guarded operation. */
export interface GuardrailAudit {
  readonly applied: readonly GuardrailAuditEntry[];
  readonly blocked: boolean;
}
