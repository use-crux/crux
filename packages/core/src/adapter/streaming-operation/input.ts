/** Remove Core-owned Safety controls before provider normalization. */
export function withoutStreamingSafetyControls<TInput>(input: TInput): TInput {
  if (typeof input !== "object" || input === null) return input;
  if (!("guardrails" in input) && !("safety" in input)) return input;
  const {
    guardrails: _guardrails,
    safety: _safety,
    ...providerInput
  } = input as TInput & {
    readonly guardrails?: unknown;
    readonly safety?: unknown;
  };
  return Object.freeze(providerInput) as TInput;
}
