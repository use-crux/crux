import type { SafetyBindingApplicability } from "./applicability";
import { SafetyConfigError } from "./errors";

const structuredOnlyBoundaries = new Set([
  "model.output.object",
  "model.output",
]);

/** Classify exact bindings for a resolved language output mode. @internal */
export function languageBindingApplicability(
  structured: boolean,
): SafetyBindingApplicability {
  return (binding) => {
    if (structured || !structuredOnlyBoundaries.has(binding.boundary.id)) {
      return { active: true };
    }

    if (binding.scope === "global") {
      return {
        active: false,
        reason: `Global policy is dormant for language text output at ${binding.boundary.id}.`,
      };
    }
    throw new SafetyConfigError({
      message:
        `Safety ${binding.kind} "${binding.policy.id}" cannot target "${binding.boundary.id}" for language text output. ` +
        "Remove the binding or use a prompt with structured output.",
      boundaries: [binding.boundary.id],
      kinds: [binding.kind],
      scopes: [binding.scope],
    });
  };
}
