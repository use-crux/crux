import type {
  Experimental_SpeechResult as AiSdkSpeechResult,
  SpeechModel,
} from "ai";
import {
  createGenerateSpeechResult,
  validateGenerateSpeechOptions,
  type GenerateSpeech,
  type GenerateSpeechOptions,
} from "@use-crux/core";
import {
  bindCompletedOperation,
  defineCompletedOperation,
} from "@use-crux/core/adapter";
import type { SdkGateway } from "./gateway";

type NativeArgs = Parameters<SdkGateway["generateSpeech"]>[0];

/** AI SDK-native speech controls forwarded unchanged. */
export interface AISpeechExtra extends Record<string, unknown> {
  readonly providerOptions?: NativeArgs["providerOptions"];
  readonly maxRetries?: NativeArgs["maxRetries"];
  readonly headers?: NativeArgs["headers"];
}

/** Provider response facts retained from the AI SDK speech result. */
export interface AISpeechMetadata {
  readonly responses: AiSdkSpeechResult["responses"];
  readonly providerMetadata: AiSdkSpeechResult["providerMetadata"];
}

/**
 * Stateless AI SDK speech operation.
 *
 * Model dispatch and provider validation remain owned by the AI SDK. The
 * returned audio is immediately usable and is never persisted automatically.
 */
export type AIGenerateSpeech = GenerateSpeech<
  SpeechModel,
  string,
  AISpeechExtra,
  AiSdkSpeechResult,
  AISpeechMetadata,
  AiSdkSpeechResult["warnings"][number]
>;

type AISpeechInput = GenerateSpeechOptions<SpeechModel, string, AISpeechExtra>;

/** Bind one native AI SDK speech operation to an injectable gateway. */
export function createAiSdkGenerateSpeech(
  gateway: SdkGateway,
): AIGenerateSpeech {
  return bindCompletedOperation({
    definition: createAiSdkSpeechOperation(gateway),
    provider: "ai-sdk",
    operation: "generateSpeech",
  });
}

/** Define AI SDK speech mechanics for provider-runtime compilation. */
export function createAiSdkSpeechOperation(gateway: SdkGateway) {
  return defineCompletedOperation({
    normalize(input: AISpeechInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateSpeechOptions(options);
      return options;
    },
    support: () => "unknown" as const,
    invoke: (options, { signal, call }) =>
      call("audio.speech", () =>
        gateway.generateSpeech({
          model: options.model,
          text: options.text,
          ...(options.voice === undefined ? {} : { voice: options.voice }),
          ...(options.outputFormat === undefined
            ? {}
            : { outputFormat: options.outputFormat }),
          ...(options.instructions === undefined
            ? {}
            : { instructions: options.instructions }),
          ...(options.speed === undefined ? {} : { speed: options.speed }),
          ...(options.language === undefined
            ? {}
            : { language: options.language }),
          ...options.extra,
          abortSignal: signal,
        }),
      ),
    validate(raw) {
      return createGenerateSpeechResult(
        {
          type: "data",
          data: raw.audio.uint8Array,
          mediaType: raw.audio.mediaType,
        },
        {
          raw,
          warnings: raw.warnings,
          providerMetadata: {
            responses: raw.responses,
            providerMetadata: raw.providerMetadata,
          },
          execution: { kind: "native", calls: 1 },
        },
      );
    },
    report: () => ({ kind: "audio" }),
    conformance: [],
  });
}
