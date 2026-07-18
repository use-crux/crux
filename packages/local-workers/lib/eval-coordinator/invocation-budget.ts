/** Invocation-wide cost cap shared by every Eval selected by one CLI command. */
export function createEvalInvocationBudget(maxCostUsd: number | undefined) {
  let remainingUsd = maxCostUsd;
  return Object.freeze({
    limit(): number | undefined {
      return remainingUsd;
    },
    consume(plan: { readonly knownMaximumUsd: number }): void {
      if (remainingUsd === undefined) return;
      const next = remainingUsd - plan.knownMaximumUsd;
      remainingUsd =
        Math.abs(next) <= Number.EPSILON * 16 ? 0 : Math.max(0, next);
    },
  });
}
