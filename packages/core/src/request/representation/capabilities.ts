/**
 * Capability ownership validation for authored alternatives.
 *
 * @module
 */

import type { z } from "zod";
import type { Context } from "../../prompt/context-types";
import { RequestCompositionError } from "../errors";

/** Reject alternatives that declare a capability set different from the primary. @internal */
export function assertAlternativeCapabilities(
  primary: Context<z.ZodType> | readonly Context<z.ZodType>[],
  alternative: Context<z.ZodType>,
  input: Record<string, unknown>,
): void {
  const declared = capabilityKeys(alternative, input);
  if (declared.length === 0) return;
  const owned = [
    ...new Set(
      (Array.isArray(primary) ? primary : [primary]).flatMap((source) =>
        capabilityKeys(source, input),
      ),
    ),
  ].sort();
  if (
    declared.length === owned.length &&
    declared.every((key, index) => key === owned[index])
  ) {
    return;
  }
  const requestId = "request_representation_capabilities";
  throw new RequestCompositionError(
    "INVALID_COMPOSITION",
    "An authored alternative declares capabilities different from its canonical source.",
    [
      {
        id: `${requestId}:capabilities`,
        code: "ALTERNATIVE_CAPABILITY_MISMATCH",
        contributor: "representation",
        message:
          "Remove capabilities from the alternative or make its declared capability set exactly match the primary source.",
      },
    ],
    requestId,
  );
}

function capabilityKeys(
  source: Context<z.ZodType>,
  input: Record<string, unknown>,
): string[] {
  const tools = source.toolsFn
    ? Object.keys(source.toolsFn(input)).map((name) => `tool:${name}`)
    : [];
  return [
    ...tools,
    ...source.constraints.map((item) => `constraint:${item.id}`),
    ...source.guardrails.map((item) => `guardrail:${item.id}`),
    ...(source.toolApproval
      ? Object.keys(source.toolApproval).map((name) => `approval:${name}`)
      : []),
  ].sort();
}
