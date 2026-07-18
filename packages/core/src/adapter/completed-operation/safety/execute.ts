import type { CompletedOperationResult } from "../../../completed-operation/contracts";
import type { Guardrail } from "../../../safety/guardrail/types";
import { createSafety, type Safety } from "../../../safety/session";
import type { SafetyTuneOptions } from "../../../safety/tune";
import { describeCompletedModel } from "../model-description";
import { guardGeneratedImageInput } from "./image-input";
import { guardGeneratedImageOutput } from "./image-output";
import {
  guardGeneratedSpeechInput,
  guardGeneratedSpeechOutput,
} from "./speech";
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

/** Apply the Core-owned input projection before provider normalization. */
export async function guardCompletedOperationInput<TInput>(
  operation: string,
  input: TInput,
  safety: Safety | undefined,
): Promise<TInput> {
  if (!safety || !isSafetyCompletedOperation(operation)) return input;

  switch (operation) {
    case "generateImage":
      return guardGeneratedImageInput(input, safety);
    case "generateSpeech":
      return guardGeneratedSpeechInput(input, safety);
    case "transcribe":
      return input;
  }
}

/** Apply the Core-owned output projection for one completed operation. */
export async function guardCompletedOperationOutput<
  TResult extends CompletedOperationResult,
>(
  operation: string,
  result: TResult,
  safety: Safety | undefined,
  selectedModel?: unknown,
): Promise<TResult> {
  if (!safety || !isSafetyCompletedOperation(operation)) return result;

  return guardKnownOutput(
    operation,
    result,
    safety,
    describeCompletedModel(selectedModel),
  );
}

async function guardKnownOutput<TResult extends CompletedOperationResult>(
  operation: SafetyCompletedOperation,
  result: TResult,
  safety: Safety,
  model?: string,
): Promise<TResult> {
  switch (operation) {
    case "generateImage":
      return guardGeneratedImageOutput(result, safety, model);
    case "generateSpeech":
      return guardGeneratedSpeechOutput(result, safety, model);
    case "transcribe":
      return result;
  }
}
