import type { ExtractContext } from "../extensions";

export const operationPolicyOptions = [
  ["guardrail.applies_to", "guardrails"],
  ["constraint.applies_to", "constraints"],
] as const;

/** Extracts authored policy references whose target is a completed media operation. */
export function operationPolicyReferences(
  ctx: ExtractContext,
  definitionId: string,
) {
  return operationPolicyOptions.flatMap(([type, property]) =>
    (ctx.config?.identifierArray(property) ?? []).map((fromVariable) => ({
      type,
      fromVariable,
      toId: definitionId,
    })),
  );
}

/** Records the authored safety-options binding without materializing its value. */
export function operationSafetySourceRefs(
  ctx: ExtractContext,
  definitionId: string,
) {
  const sourceRef = ctx.sourceRef.property({
    definitionId,
    property: "safety",
    role: "config",
  });
  return sourceRef ? [sourceRef] : [];
}
