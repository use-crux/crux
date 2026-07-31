import type { MeasuredRequestCandidate } from "./select";

/** Compare request candidates by lexicographic fidelity, then size. @internal */
export function compareRequestFidelity<
  TExtra extends Record<string, unknown>,
>(
  left: MeasuredRequestCandidate<TExtra>,
  right: MeasuredRequestCandidate<TExtra>,
): number {
  const length = Math.max(left.fidelity.length, right.fidelity.length);
  for (let index = 0; index < length; index++) {
    const difference =
      (left.fidelity[index] ?? 0) - (right.fidelity[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.inputTokens - right.inputTokens;
}
