/**
 * Private contracts for provider-visible tool exposure evaluation.
 *
 * @internal
 * @module
 */

import type {
  ToolDefinitionGuardrailResult,
  ToolDefinitionOrigin,
  ToolDefinitionSubject,
  ToolDescriptionOrigin,
} from "../../../safety";
import type { ClosedGuardrailRunResult } from "../../../safety/guardrail/types";

/** Safety-owned callbacks used by the tool lifecycle exposure transaction. */
export interface ToolExposureGuards {
  /** Evaluate one recursively frozen provider-visible root definition. */
  readonly root: (
    subject: ToolDefinitionSubject,
    origin: ToolDefinitionOrigin,
  ) =>
    | ToolDefinitionGuardrailResult
    | Promise<ToolDefinitionGuardrailResult>;
  /** Evaluate one provider-visible tool or schema description occurrence. */
  readonly descriptions: (
    text: string,
    origin: ToolDescriptionOrigin,
  ) =>
    | ClosedGuardrailRunResult<string>
    | Promise<ClosedGuardrailRunResult<string>>;
}

/** Private winning provenance attached before tool registry merging. */
export type ToolExposureProvenance =
  | { readonly kind: "authored" }
  | {
      readonly kind: "discovered";
      readonly sourceId: string;
      readonly sourceKind: string;
    };
