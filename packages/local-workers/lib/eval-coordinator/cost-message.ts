interface CostAction {
  readonly estimate:
    | { readonly kind: "none" | "known" }
    | {
        readonly kind: "unknown";
        readonly missingPricingKeys: readonly string[];
        readonly remedy: string;
      };
}

/** Explain pre-spend cost rejection without hiding missing model prices. */
export function costAdmissionMessage(
  evalId: string,
  reason: string,
  actions: readonly CostAction[],
): string {
  if (reason === "unknown_cost_under_cap") {
    const unknown = actions
      .map((action) => action.estimate)
      .filter((estimate) => estimate.kind === "unknown");
    const keys = [
      ...new Set(unknown.flatMap((estimate) => estimate.missingPricingKeys)),
    ].sort();
    const remedies = [...new Set(unknown.map((estimate) => estimate.remedy))];
    return `Cannot enforce --max-cost for Eval '${evalId}' because a conservative maximum is unavailable.${keys.length > 0 ? ` Missing pricing keys: ${keys.join(", ")}.` : ""} ${remedies.join(" ")} Run --plan without spending to inspect every action.`;
  }
  if (reason === "max_cost_exceeded") {
    return `Eval '${evalId}' exceeds --max-cost; no external calls were made.`;
  }
  return `Eval '${evalId}' has unknown external cost and requires confirmation; no external calls were made. Run --plan to inspect the actions.`;
}
