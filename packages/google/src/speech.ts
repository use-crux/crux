import type {
  GenerateContentConfig,
  GenerateContentResponse,
  GoogleGenAI,
  SpeakerVoiceConfig,
  VoiceConfig,
} from "@google/genai";
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

/** Google voice selection: a prebuilt name, native voice config, or native multi-speaker config. */
export type GoogleSpeechVoice =
  | string
  | Readonly<VoiceConfig>
  | Readonly<{
      speakerVoiceConfigs?: readonly Readonly<SpeakerVoiceConfig>[];
    }>;

/** Google-native generation controls that do not overlap portable speech controls. */
export type GoogleSpeechExtra = Omit<
  GenerateContentConfig,
  "abortSignal" | "responseModalities" | "speechConfig"
> &
  Record<string, unknown>;

/**
 * Flat native Google speech operation attached to a bound adapter.
 *
 * The operation performs one `generateContent` audio call, returns usable
 * bytes, never persists media, and propagates native failures unchanged.
 */
export type GoogleGenerateSpeech = GenerateSpeech<
  string,
  GoogleSpeechVoice,
  GoogleSpeechExtra,
  GenerateContentResponse
>;

type GoogleSpeechInput = GenerateSpeechOptions<
  string,
  GoogleSpeechVoice,
  GoogleSpeechExtra
>;

/** Bind one stateless native Google speech operation. */
export function createGoogleGenerateSpeech(
  client: GoogleGenAI,
): GoogleGenerateSpeech {
  return bindCompletedOperation({
    definition: createGoogleSpeechOperation(client),
    provider: "google",
    operation: "generateSpeech",
  });
}

/** Define Google speech mechanics for provider-runtime compilation. */
export function createGoogleSpeechOperation(client: GoogleGenAI) {
  return defineCompletedOperation({
    normalize(input: GoogleSpeechInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateSpeechOptions(options);
      const issue = googleSpeechIssue(options);
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: "google",
          model: options.model,
          issues: [issue],
        });
      }
      return options;
    },
    support: () => "supported" as const,
    invoke: (options, { signal, call }) =>
      call("generation.speech", () =>
        client.models.generateContent({
          model: options.model,
          contents: [{ role: "user", parts: [{ text: options.text }] }],
          config: {
            ...options.extra,
            abortSignal: signal,
            responseModalities: ["AUDIO"],
            ...(speechConfig(options) === undefined
              ? {}
              : { speechConfig: speechConfig(options) }),
          },
        }),
      ),
    validate(raw) {
      const part = raw.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .find((candidatePart) => candidatePart.inlineData?.data);
      const data = part?.inlineData?.data;
      const mediaType = part?.inlineData?.mimeType;
      if (typeof mediaType !== "string" || !mediaType.startsWith("audio/")) {
        throw new TypeError(
          "Google speech response omitted a valid audio MIME type.",
        );
      }
      return createGenerateSpeechResult(
        {
          type: "data",
          data: new Uint8Array(Buffer.from(data ?? "", "base64")),
          mediaType,
        },
        { raw, warnings: [], execution: { kind: "native", calls: 1 } },
      );
    },
    report: () => ({ kind: "audio" }),
    conformance: [],
  });
}

function speechConfig(options: GoogleSpeechInput) {
  if (options.voice === undefined && options.language === undefined)
    return undefined;
  return {
    ...(options.language === undefined
      ? {}
      : { languageCode: options.language }),
    ...(options.voice === undefined
      ? {}
      : isMultiSpeaker(options.voice)
        ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: options.voice.speakerVoiceConfigs?.map(
                (item) => ({ ...item }),
              ),
            },
          }
        : {
            voiceConfig:
              typeof options.voice === "string"
                ? { prebuiltVoiceConfig: { voiceName: options.voice } }
                : options.voice,
          }),
  };
}

function isMultiSpeaker(voice: GoogleSpeechVoice): voice is Readonly<{
  speakerVoiceConfigs?: readonly Readonly<SpeakerVoiceConfig>[];
}> {
  return typeof voice === "object" && "speakerVoiceConfigs" in voice;
}

function googleSpeechIssue(options: GoogleSpeechInput) {
  if (KNOWN_NON_SPEECH_MODELS.has(options.model))
    return issue("speech.model", "model");
  if (options.outputFormat !== undefined)
    return issue("speech.output-format", "outputFormat");
  if (options.instructions !== undefined)
    return issue("speech.instructions", "instructions");
  if (options.speed !== undefined) return issue("speech.speed", "speed");
  if (
    options.voice &&
    isMultiSpeaker(options.voice) &&
    options.voice.speakerVoiceConfigs?.length !== 2
  ) {
    return issue("speech.multi-speaker", "voice.speakerVoiceConfigs");
  }
  return undefined;
}

const KNOWN_NON_SPEECH_MODELS = Object.freeze(
  new Set(["gemini-2.0-flash", "gemini-2.5-flash", "gemini-2.5-pro"]),
);

function issue(capability: string, path: string) {
  return {
    capability,
    path,
    remediation:
      "Use native Google speech model controls; Crux does not emulate speech options in prompt text.",
  };
}
