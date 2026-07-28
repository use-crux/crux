import { SafetyConfigError } from "../../../safety/errors";
import type { SafetyBindingApplicability } from "../../../safety/applicability";
import type { SafetyCompletedOperation } from "./operation";

export type SafetyMediaOperation =
  | SafetyCompletedOperation
  | "streamImage"
  | "streamSpeech";

const applicableBoundaries = {
  generateImage: new Set([
    "model.input.text",
    "model.instructions",
    "model.input.media",
    "model.output.media",
  ]),
  generateSpeech: new Set([
    "model.input.text",
    "model.instructions",
    "model.output.media",
  ]),
  transcribe: new Set([
    "model.input.text",
    "model.input.media",
    "model.output.text",
  ]),
  streamImage: new Set([
    "model.input.text",
    "model.instructions",
    "model.input.media",
    "model.output.media",
  ]),
  streamSpeech: new Set([
    "model.input.text",
    "model.instructions",
    "model.output.media",
  ]),
} satisfies Record<SafetyMediaOperation, ReadonlySet<string>>;

/** Narrow a public operation name to a media operation with Safety projections. */
export function isSafetyMediaOperation(
  operation: string,
): operation is SafetyMediaOperation {
  return operation in applicableBoundaries;
}

/** Classify exact bindings for one closed completed-operation primitive. */
export function completedOperationBindingApplicability(
  operation: SafetyCompletedOperation,
): SafetyBindingApplicability {
  return mediaOperationBindingApplicability(operation);
}

/** Classify exact bindings for one completed or bounded-stream media primitive. */
export function mediaOperationBindingApplicability(
  operation: SafetyMediaOperation,
): SafetyBindingApplicability {
  return (binding) => {
    if (applicableBoundaries[operation].has(binding.boundary.id))
      return { active: true };

    if (binding.scope === "global") {
      return {
        active: false,
        reason: `Global policy is dormant for ${operation} at ${binding.boundary.id}.`,
      };
    }
    throw new SafetyConfigError({
      message:
        `Safety ${binding.kind} "${binding.policy.id}" cannot target "${binding.boundary.id}" for ${operation}. ` +
        "Remove the binding or attach it to a boundary supported by this operation.",
      boundaries: [binding.boundary.id],
      kinds: [binding.kind],
      scopes: [binding.scope],
    });
  };
}
