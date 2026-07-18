import type { CompletedOperationResult } from "../../../completed-operation/contracts";
import type { Guardrail } from "../../../safety/guardrail/types";
import { createSafety, type Safety } from "../../../safety/session";
import type { SafetyTuneOptions } from "../../../safety/tune";
import { describeCompletedModel } from "../model-description";
import { guardGeneratedImageOutput } from "./image-output";
import {
  isSafetyCompletedOperation,
  type SafetyCompletedOperation,
} from "./operation";

/** Build one completed-operation Safety session before provider preflight. */
export function createCompletedOperationSafety(
  options: Readonly<{
    operation: string;
    model: unknown;
    guardrails?: readonly Guardrail[];
    safety?: SafetyTuneOptions;
  }>,
): Safety | undefined {
  if (!isSafetyCompletedOperation(options.operation)) return undefined;

  const safety = createSafety({
    call: { guardrails: options.guardrails },
    promptId: undefined,
    model: describeCompletedModel(options.model),
    safety: options.safety,
  });
  return safety.enabled ? safety : undefined;
}

/** Apply the Core-owned output projection for one completed operation. */
export async function guardCompletedOperationOutput<
  TResult extends CompletedOperationResult,
>(
  operation: string,
  result: TResult,
  safety: Safety | undefined,
): Promise<TResult> {
  if (!safety || !isSafetyCompletedOperation(operation)) return result;

  return guardKnownOutput(operation, result, safety);
}

async function guardKnownOutput<TResult extends CompletedOperationResult>(
  operation: SafetyCompletedOperation,
  result: TResult,
  safety: Safety,
): Promise<TResult> {
  switch (operation) {
    case "generateImage":
      return guardGeneratedImageOutput(result, safety);
    case "generateSpeech":
    case "transcribe":
      return result;
  }
}
