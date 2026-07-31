/**
 * Public contracts for observational request planning.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { GenerationSettings } from "../../generation/types";
import type { AnyToolSet } from "../../types";
import type { InputBudget } from "../budget/input-budget";
import type { RequestDiagnostic } from "../errors";
import type { RequestWarning } from "../receipt/adaptations";

/** Whether a prospective representation is executable without preparation. */
export type PreviewAdaptationState = "selected" | "unprepared";

/** One redacted representation decision considered by request preview. */
export interface PreviewAdaptation {
  /** Safe contributor identity. */
  readonly contributor: string;
  /** Prospective representation kind. */
  readonly representation:
    | "authored"
    | "summary"
    | "offload"
    | "omitted";
  /** Whether the representation is ready or still requires preparation. */
  readonly state: PreviewAdaptationState;
  /** Complete-request size at the full representation. */
  readonly fullTokens?: number;
  /** Complete-request size after the prospective adaptation. */
  readonly selectedTokens?: number;
}

/** Result of planning one request without reserving or executing it. */
export interface RequestPreview {
  /** Whether a ready request fits, cannot fit, or depends on runtime work. */
  readonly status: "fits" | "over-limit" | "unknown";
  /** Concrete model identity when one was available. */
  readonly model?: string;
  /** Measured prospective input size when it could be determined. */
  readonly inputTokens?: number;
  /** Effective strict input maximum. */
  readonly maxInputTokens?: number;
  /** Confidence of the observational measurement. */
  readonly measurement:
    | "exact"
    | "estimated"
    | "conservative"
    | "incomplete";
  /** Authorized prospective deviations from full exact representations. */
  readonly adaptations: readonly PreviewAdaptation[];
  /** Non-fatal planning warnings. */
  readonly warnings: readonly RequestWarning[];
  /** Redacted reasons and remedies. */
  readonly diagnostics: readonly RequestDiagnostic[];
}

/**
 * Invocation options accepted by {@link preview}.
 *
 * Preview resolves the same prompt input and request-pressure settings as
 * execution. It never runs preparation callbacks, Tools, or provider calls.
 */
export interface RequestPreviewOptions {
  /** Prompt input. */
  readonly input?: Record<string, unknown>;
  /** Concrete model or model-like object; optional for an Agent with a model. */
  readonly model?: unknown;
  /** Provider identity used for prompt adaptation. */
  readonly provider?: string;
  /** Caller-owned canonical history. */
  readonly messages?: readonly Message[];
  /** Whole-request input pressure settings. */
  readonly inputBudget?: InputBudget;
  /** Generation settings that affect request shape or output reserve. */
  readonly settings?: GenerationSettings;
  /** Additional call-site Tools included in measurement. */
  readonly tools?: AnyToolSet;
}
