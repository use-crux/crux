import { toFile, type Uploadable } from "openai";
import type OpenAI from "openai";
import type {
  TranscriptionCreateParamsNonStreaming,
  TranscriptionCreateResponse,
} from "openai/resources/audio/transcriptions";
import type {
  TranslationCreateParams,
  TranslationCreateResponse,
} from "openai/resources/audio/translations";
import {
  createUnsupportedCapabilityError,
  normalizeAudioSource,
  validateTranscribeOptions,
  validateTranscriptionResult,
  type DataAsset,
  type Transcribe,
  type TranscribeOptions,
} from "@use-crux/core";
import {
  bindCompletedOperation,
  defineCompletedOperation,
} from "@use-crux/core/adapter";
import { downloadAudio } from "@use-crux/core/transcription/node";
import {
  isTranslation,
  openAITranscriptionIssue,
  requestedSegments,
  requestedWords,
  responseFormatFor,
  timestampGranularities,
} from "./transcription-options";

type NativeControls = Omit<
  TranscriptionCreateParamsNonStreaming,
  "file" | "model" | "language" | "prompt" | "response_format" | "stream"
>;

/** OpenAI translation controls supported by the installed translations endpoint. */
export type OpenAITranslationExtra = Readonly<
  Pick<TranslationCreateParams, "temperature">
>;

/** OpenAI-native non-streaming transcription controls. */
export type OpenAITranscriptionExtra = NativeControls & {
  readonly response_format?: "json" | "verbose_json" | "diarized_json";
};

/** Safe OpenAI transcription metadata projected from the native response. */
export interface OpenAITranscriptionMetadata {
  readonly usage?: TranscriptionCreateResponse["usage"];
}

type OpenAITranscriptionRaw =
  | TranscriptionCreateResponse
  | TranslationCreateResponse;

/** Flat transcription operation attached to a bound OpenAI adapter. */
export type OpenAITranscribe = Transcribe<
  string,
  OpenAITranscriptionExtra,
  OpenAITranscriptionRaw,
  OpenAITranscriptionMetadata
>;
export type OpenAITranscriptionInput = TranscribeOptions<
  string,
  OpenAITranscriptionExtra
>;

/** Build one stateless OpenAI audio transcription operation. */
export function createOpenAITranscribe(client: OpenAI): OpenAITranscribe {
  return bindCompletedOperation({
    definition: createOpenAITranscriptionOperation(client),
    provider: "openai",
    operation: "transcribe",
  });
}

/** Define OpenAI transcription mechanics for first-class provider-runtime compilation. */
export function createOpenAITranscriptionOperation(client: OpenAI) {
  const definition = defineCompletedOperation({
    async normalize(input: OpenAITranscriptionInput, context) {
      const options = { ...input, model: context.model };
      validateTranscribeOptions(options);
      const issue = openAITranscriptionIssue(options);
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: "openai",
          model: options.model,
          issues: [issue],
        });
      }
      const audio = await normalizeAudioSource(options.audio);
      if (audio.type === "provider-file") {
        throw createUnsupportedCapabilityError({
          adapter: "openai",
          model: options.model,
          issues: [
            {
              capability: "transcription.provider-file",
              path: "audio",
              mediaType: audio.mediaType,
              remediation:
                "Pass audio bytes, a Blob, data URL, or an HTTPS URL.",
            },
          ],
        });
      }
      return { options, audio };
    },
    support: () => "supported" as const,
    async invoke(
      { options, audio },
      { signal, call },
    ): Promise<OpenAITranscriptionRaw> {
      const materialized =
        audio.type === "url"
          ? await downloadAudio(audio.url, { signal })
          : audio;
      const responseFormat = responseFormatFor(options);
      if (isTranslation(options)) {
        return call(
          "audio.translate",
          async () =>
            client.audio.translations.create(
              {
                ...(translationExtra(options.extra).temperature === undefined
                  ? {}
                  : {
                      temperature: translationExtra(options.extra).temperature,
                    }),
                file: await uploadable(materialized),
                model: options.model,
                ...(options.prompt === undefined
                  ? {}
                  : { prompt: options.prompt }),
                response_format:
                  responseFormat === "verbose_json" ? "verbose_json" : "json",
              } as TranslationCreateParams,
              { signal },
            ) as Promise<TranslationCreateResponse>,
        );
      }
      return call(
        "audio.transcribe",
        async () =>
          client.audio.transcriptions.create(
            {
              ...options.extra,
              file: await uploadable(materialized),
              model: options.model,
              response_format: responseFormat,
              ...(options.language === undefined
                ? {}
                : { language: options.language }),
              ...(options.prompt === undefined
                ? {}
                : { prompt: options.prompt }),
              ...(timestampGranularities(options) === undefined
                ? {}
                : { timestamp_granularities: timestampGranularities(options) }),
              stream: false,
            } as TranscriptionCreateParamsNonStreaming,
            { signal },
          ) as Promise<TranscriptionCreateResponse>,
      );
    },
    validate(raw, { options }) {
      const segments =
        "segments" in raw && Array.isArray(raw.segments)
          ? raw.segments.map((segment) => ({
              text: segment.text,
              startSecond: segment.start,
              endSecond: segment.end,
              ...("speaker" in segment && typeof segment.speaker === "string"
                ? { speaker: segment.speaker }
                : {}),
            }))
          : [];
      const words =
        "words" in raw && Array.isArray(raw.words)
          ? raw.words.map((word) => ({
              text: word.word,
              startSecond: word.start,
              endSecond: word.end,
            }))
          : [];
      const warnings: string[] = [];
      if (requestedSegments(options) && segments.length === 0) {
        warnings.push(
          "OpenAI transcription response omitted requested timestamp segments.",
        );
      }
      if (requestedWords(options) && words.length === 0) {
        warnings.push(
          "OpenAI transcription response omitted requested word timestamps.",
        );
      }
      const language =
        "language" in raw && typeof raw.language === "string"
          ? raw.language
          : undefined;
      const usage = transcriptionUsage(raw);
      const durationInSeconds =
        "duration" in raw && typeof raw.duration === "number"
          ? raw.duration
          : durationUsage(usage);
      return validateTranscriptionResult(
        {
          text: raw.text,
          segments,
          words,
          warnings,
          execution: { kind: "native", calls: 1 },
          ...(language === undefined ? {} : { language }),
          ...(durationInSeconds === undefined ? {} : { durationInSeconds }),
          ...(usage === undefined ? {} : { providerMetadata: { usage } }),
        },
        raw,
      );
    },
    report: (result) => ({
      kind: "audio",
      segments: result.segments.length,
      words: result.words.length,
    }),
    conformance: [],
  });
  return definition;
}

function transcriptionUsage(
  raw: OpenAITranscriptionRaw,
): TranscriptionCreateResponse["usage"] {
  return "usage" in raw
    ? (raw as TranscriptionCreateResponse).usage
    : undefined;
}

function translationExtra(
  extra: OpenAITranscriptionExtra | undefined,
): OpenAITranslationExtra {
  return extra?.temperature === undefined
    ? {}
    : { temperature: extra.temperature };
}

async function uploadable(asset: DataAsset): Promise<Uploadable> {
  return toFile(
    asset.data,
    asset.filename ?? `audio.${extensionFor(asset.mediaType)}`,
    { type: asset.mediaType },
  );
}

function durationUsage(
  usage: TranscriptionCreateResponse["usage"],
): number | undefined {
  return usage && "seconds" in usage && typeof usage.seconds === "number"
    ? usage.seconds
    : undefined;
}

function extensionFor(mediaType: string): string {
  if (mediaType.includes("wav")) return "wav";
  if (mediaType.includes("flac")) return "flac";
  if (mediaType.includes("ogg")) return "ogg";
  if (mediaType.includes("webm")) return "webm";
  if (mediaType.includes("mp4") || mediaType.includes("m4a")) return "m4a";
  return "mp3";
}
