/** GenerationModel preflight shared by Agent Session create and send paths. */

import type { AnyAgent } from "../agent";
import type { GenerationModel } from "../generation-model";
import {
  GenerationModelBindingError,
  GenerationModelCapabilityError,
} from "./errors";

/** Validate the executable model before Session-owned state can change. */
export function requireCompatibleModel(
  target: AnyAgent,
  value: unknown,
): GenerationModel {
  if (!isGenerationModel(value)) throw new GenerationModelBindingError();
  const required = ["text-input", "text-output"];
  if (target.prompt.outputSchema) required.push("structured-output");
  if (target.tools && Object.keys(target.tools).length > 0) {
    required.push("tool-calls");
  }
  const missing = required.filter(
    (capability) => !value.capabilities.language.includes(capability as never),
  );
  if (missing.length > 0) throw new GenerationModelCapabilityError(missing);
  return value;
}

export function isGenerationModel(value: unknown): value is GenerationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    value._tag === "crux.generation-model"
  );
}
