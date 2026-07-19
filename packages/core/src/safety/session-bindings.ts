import type { Constraint } from "./constraint/types";
import type { GuardrailBinding, SafetyBinding } from "./registry";

/** Select active guardrails without changing authored declaration order. */
export function enabledGuardrailBindings(
  bindings: readonly SafetyBinding[],
): GuardrailBinding[] {
  return bindings.filter(
    (binding): binding is GuardrailBinding =>
      binding.kind === "guardrail" &&
      binding.enabled &&
      binding.dormantReason === undefined,
  );
}

/** Select unique active constraints for one enforcement posture. */
export function constraintsForMode(
  bindings: readonly SafetyBinding[],
  mode: "enforce" | "report",
): Constraint[] {
  return uniquePolicies(
    bindings
      .filter(
        (binding) =>
          binding.kind === "constraint" &&
          binding.enabled &&
          binding.mode === mode &&
          binding.dormantReason === undefined,
      )
      .map((binding) => binding.policy as Constraint),
  );
}

function uniquePolicies<TPolicy extends object>(
  policies: readonly TPolicy[],
): TPolicy[] {
  const seen = new Set<TPolicy>();
  return policies.filter((policy) => {
    if (seen.has(policy)) return false;
    seen.add(policy);
    return true;
  });
}
