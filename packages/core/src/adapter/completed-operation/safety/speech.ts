import type { DataAsset } from "../../../asset/types";
import type { CompletedOperationProviderPayload } from "../../../completed-operation/contracts";
import type { MediaPartSubject } from "../../../safety/boundary";
import { freezeSafetyAudit, hasSafetyAudit } from "../../../safety/audit";
import { SafetyResultError } from "../../../safety/errors";
import {
  guardSafetySessionInputOperationText,
  guardSafetySessionOutputMedia,
  type Safety,
} from "../../../safety/session";
import type { GuardrailContext } from "../../../safety/guardrail/types";

type GeneratedSpeechResult = CompletedOperationProviderPayload &
  Readonly<{ readonly audio: DataAsset }>;

type SpeechInput = Readonly<{
  readonly text: string;
  readonly instructions?: string;
}>;

/** Guard speech text and optional instructions before provider normalization. */
export async function guardGeneratedSpeechInput<TInput>(
  input: TInput,
  safety: Safety,
): Promise<TInput> {
  if (!isSpeechInput(input)) return input;

  const slots = await guardSafetySessionInputOperationText(safety, [
    { boundary: "model.input.text", value: input.text },
    ...(input.instructions === undefined
      ? []
      : [
          {
            boundary: "model.instructions" as const,
            value: input.instructions,
          },
        ]),
  ]);
  const text = slots[0]?.value ?? input.text;
  const instructions = slots[1]?.value ?? input.instructions;
  if (text === input.text && instructions === input.instructions) return input;

  return Object.freeze({ ...input, text, instructions }) as TInput;
}

/** Guard required generated audio and attach canonical Safety audit immutably. */
export async function guardGeneratedSpeechOutput<
  TResult extends CompletedOperationProviderPayload,
>(
  result: TResult,
  safety: Safety,
  model?: string,
  operation: "generateSpeech" | "streamSpeech" = "generateSpeech",
  stream?: GuardrailContext["stream"],
): Promise<TResult> {
  if (!isGeneratedSpeechResult(result)) {
    throw new SafetyResultError({
      message:
        "Completed generateSpeech Safety requires a canonical audio result.",
      policyId: "completed-operation",
      boundary: "model.output.media",
      problem: "generateSpeech result has no canonical audio field",
    });
  }

  await guardSafetySessionOutputMedia(
    safety,
    [audioSubject(result.audio, operation)],
    {
      minimumRetained: 1,
      model,
      stream,
    },
  );
  const audit = safety.audit;
  if (!hasSafetyAudit(audit)) return result;

  return Object.freeze({
    ...result,
    safety: freezeSafetyAudit(audit),
  });
}

function audioSubject(
  audio: DataAsset,
  operation: "generateSpeech" | "streamSpeech",
): MediaPartSubject {
  return Object.freeze({
    part: Object.freeze({
      type: "audio" as const,
      source: audio,
      mediaType: audio.mediaType,
    }),
    origin: Object.freeze(
      operation === "generateSpeech"
        ? {
            kind: "operation" as const,
            operation,
            phase: "output" as const,
            field: "audio" as const,
            partIndex: 0 as const,
          }
        : {
            kind: "operation" as const,
            operation,
            phase: "final" as const,
            field: "audio" as const,
            outputIndex: 0 as const,
          },
    ),
  });
}

function isGeneratedSpeechResult(
  result: CompletedOperationProviderPayload,
): result is GeneratedSpeechResult {
  return "audio" in result;
}

function isSpeechInput(value: unknown): value is SpeechInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "text" in value &&
    typeof value.text === "string"
  );
}
