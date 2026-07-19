import type { CompletedOperationProviderPayload } from "../../../completed-operation/contracts";
import {
  createSafetyWithBindingApplicability,
  type Safety,
} from "../../../safety/session";
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
import {
  guardTranscriptionInput,
  guardTranscriptionOutput,
} from "./transcription";
import { completedOperationBindingApplicability } from "./applicability";
import type { CompletedOperationSafetyOptions } from "./options";
import type { Guardrail } from "../../../safety/guardrail/types";

/** Build one completed-operation Safety session before provider preflight. */
export function createCompletedOperationSafety(
  options: Readonly<{
    operation: string;
    model: unknown;
    promptId?: string;
    systemPrompt?: string;
    resolved?: {
      readonly guardrails?: readonly Guardrail[];
      readonly metadata?: Readonly<Record<string, unknown>>;
    };
  }> &
    CompletedOperationSafetyOptions,
): Safety | undefined {
  if (!isSafetyCompletedOperation(options.operation)) return undefined;
  const safety = createSafetyWithBindingApplicability(
    {
      call: {
        guardrails: options.guardrails,
        constraints: options.constraints,
      },
      resolved: options.resolved,
      promptId: options.promptId,
      model: describeCompletedModel(options.model),
      systemPrompt: options.systemPrompt,
      safety: options.safety,
    },
    completedOperationBindingApplicability(options.operation),
  );
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
      return guardTranscriptionInput(input, safety);
  }
}

/** Apply the Core-owned output projection for one completed operation. */
export async function guardCompletedOperationOutput<
  TResult extends CompletedOperationProviderPayload,
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

async function guardKnownOutput<TResult extends CompletedOperationProviderPayload>(
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
      return guardTranscriptionOutput(result, safety, model);
  }
}
