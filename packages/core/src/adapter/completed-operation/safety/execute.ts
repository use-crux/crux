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
import type { CompletedOperationSafetyOptions } from "./options";
import type { Guardrail } from "../../../safety/guardrail/types";
import { freezeSafetyAudit, hasSafetyAudit } from "../../../safety/audit";
import {
  isSafetyMediaOperation,
  mediaOperationBindingApplicability,
  type SafetyMediaOperation,
} from "./applicability";

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
  return createMediaOperationSafety({
    ...options,
    operation: options.operation,
  });
}

/** Build one media-operation Safety session before provider preflight. */
export function createMediaOperationSafety(
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
  if (!isSafetyMediaOperation(options.operation)) return undefined;
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
    mediaOperationBindingApplicability(options.operation),
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
  return guardMediaOperationInput(operation, input, safety);
}

/** Apply the shared input projection for completed and streaming media. */
export async function guardMediaOperationInput<TInput>(
  operation: SafetyMediaOperation,
  input: TInput,
  safety: Safety | undefined,
): Promise<TInput> {
  if (!safety) return input;
  switch (operation) {
    case "generateImage":
    case "streamImage":
      return guardGeneratedImageInput(input, safety);
    case "generateSpeech":
    case "streamSpeech":
      return guardGeneratedSpeechInput(input, safety);
    case "transcribe":
      return guardTranscriptionInput(input, safety);
  }
}

/** Attach the immutable audit collected before terminal output guarding. */
export function attachOperationSafetyAudit<
  TResult extends CompletedOperationProviderPayload,
>(result: TResult, safety: Safety | undefined): TResult {
  if (!safety || !hasSafetyAudit(safety.audit)) return result;
  return Object.freeze({
    ...result,
    safety: freezeSafetyAudit(safety.audit),
  });
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

async function guardKnownOutput<
  TResult extends CompletedOperationProviderPayload,
>(
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
