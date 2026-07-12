import type OpenAI from "openai";
import type { SpeechCreateParams } from "openai/resources/audio/speech";
import {
  createGenerateSpeechResult,
  createUnsupportedCapabilityError,
  validateGenerateSpeechOptions,
  type GenerateSpeech,
  type GenerateSpeechOptions,
} from "@use-crux/core";
import {
  bindCompletedOperation,
  defineCompletedOperation,
} from "@use-crux/core/adapter";

type NativeExtra = Omit<
  SpeechCreateParams,
  "input" | "model" | "voice" | "instructions" | "response_format" | "speed"
>;

/** OpenAI-native speech controls without a portable Crux equivalent. */
export type OpenAISpeechExtra = Readonly<NativeExtra>;

/** Voice names and custom voice references accepted by OpenAI speech models. */
export type OpenAISpeechVoice = SpeechCreateParams["voice"];

/**
 * Flat OpenAI speech operation attached to a bound adapter.
 *
 * It performs one native Speech API call, never persists the returned bytes,
 * and propagates provider failures unchanged.
 *
 * @example
 * ```ts
 * const result = await openai.generateSpeech({
 *   model: 'gpt-4o-mini-tts', text: 'Hello', voice: 'alloy', outputFormat: 'mp3'
 * })
 * ```
 */
export type OpenAIGenerateSpeech = GenerateSpeech<
  string,
  OpenAISpeechVoice,
  OpenAISpeechExtra,
  Response
>;

type OpenAISpeechInput = GenerateSpeechOptions<
  string,
  OpenAISpeechVoice,
  OpenAISpeechExtra
>;

/** Bind one stateless native OpenAI speech operation. */
export function createOpenAIGenerateSpeech(
  client: OpenAI,
): OpenAIGenerateSpeech {
  return bindCompletedOperation({
    definition: createOpenAISpeechOperation(client),
    provider: "openai",
    operation: "generateSpeech",
  });
}

/** Define OpenAI speech mechanics for provider-runtime compilation. */
export function createOpenAISpeechOperation(client: OpenAI) {
  return defineCompletedOperation({
    normalize(input: OpenAISpeechInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateSpeechOptions(options);
      const issue = speechIssue(options);
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: "openai",
          model: options.model,
          issues: [issue],
        });
      }
      return options;
    },
    support: () => "supported" as const,
    invoke: (options, { signal, call }) =>
      call("audio.speech", async () => {
        const raw = await client.audio.speech.create(
          {
            ...options.extra,
            model: options.model,
            input: options.text,
            voice: options.voice ?? "alloy",
            ...(options.outputFormat === undefined
              ? {}
              : {
                  response_format:
                    options.outputFormat as SpeechCreateParams["response_format"],
                }),
            ...(options.instructions === undefined
              ? {}
              : { instructions: options.instructions }),
            ...(options.speed === undefined ? {} : { speed: options.speed }),
          },
          { signal },
        );
        return { raw, bytes: new Uint8Array(await raw.arrayBuffer()) };
      }),
    validate(native, options) {
      return createGenerateSpeechResult(
        {
          type: "data",
          data: native.bytes,
          mediaType: mediaTypeFor(options.outputFormat),
        },
        {
          raw: native.raw,
          warnings: [],
          execution: { kind: "native", calls: 1 },
        },
      );
    },
    report: (result) => ({ kind: "audio", size: result.audio.size }),
    conformance: [],
  });
}

function speechIssue(options: OpenAISpeechInput) {
  if (options.language !== undefined) {
    return {
      capability: "speech.language",
      path: "language",
      remediation: "OpenAI speech does not expose a native language control.",
    };
  }
  if (
    options.instructions !== undefined &&
    ["tts-1", "tts-1-hd"].includes(options.model)
  ) {
    return {
      capability: "speech.instructions",
      path: "instructions",
      remediation: "Use gpt-4o-mini-tts for native speech instructions.",
    };
  }
  if (
    options.outputFormat !== undefined &&
    !["mp3", "opus", "aac", "flac", "wav", "pcm"].includes(options.outputFormat)
  ) {
    return {
      capability: "speech.output-format",
      path: "outputFormat",
      remediation: "Use mp3, opus, aac, flac, wav, or pcm.",
    };
  }
  if (
    options.speed !== undefined &&
    (options.speed < 0.25 || options.speed > 4)
  ) {
    return {
      capability: "speech.speed",
      path: "speed",
      remediation: "OpenAI speech speed must be between 0.25 and 4.",
    };
  }
  return undefined;
}

function mediaTypeFor(format: string | undefined): string {
  switch (format) {
    case "opus":
      return "audio/opus";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/pcm";
    default:
      return "audio/mpeg";
  }
}
