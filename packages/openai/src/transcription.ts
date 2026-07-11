import { toFile, type Uploadable } from "openai";
import type OpenAI from "openai";
import type {
  TranscriptionCreateParamsNonStreaming,
  TranscriptionCreateResponse,
} from "openai/resources/audio/transcriptions";
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

type NativeControls = Omit<
  TranscriptionCreateParamsNonStreaming,
  "file" | "model" | "language" | "prompt" | "response_format" | "stream"
>;

/** OpenAI-native non-streaming transcription controls. */
export type OpenAITranscriptionExtra = NativeControls & {
  readonly response_format?: "json" | "verbose_json" | "diarized_json";
};

/** Safe OpenAI transcription metadata projected from the native response. */
export interface OpenAITranscriptionMetadata {
  readonly usage?: TranscriptionCreateResponse["usage"];
}

/** Flat transcription operation attached to a bound OpenAI adapter. */
export type OpenAITranscribe = Transcribe<
  string,
  OpenAITranscriptionExtra,
  TranscriptionCreateResponse,
  OpenAITranscriptionMetadata
>;
type OpenAITranscriptionInput = TranscribeOptions<
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
    async invoke({ options, audio }, { signal }) {
      const materialized =
        audio.type === "url"
          ? await downloadAudio(audio.url, { signal })
          : audio;
      const responseFormat = responseFormatFor(options);
      return client.audio.transcriptions.create(
        {
          ...options.extra,
          file: await uploadable(materialized),
          model: options.model,
          response_format: responseFormat,
          ...(options.language === undefined
            ? {}
            : { language: options.language }),
          ...(options.prompt === undefined ? {} : { prompt: options.prompt }),
          ...(timestampGranularities(options) === undefined
            ? {}
            : { timestamp_granularities: timestampGranularities(options) }),
          stream: false,
        } as TranscriptionCreateParamsNonStreaming,
        { signal },
      ) as Promise<TranscriptionCreateResponse>;
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
      const durationInSeconds =
        "duration" in raw && typeof raw.duration === "number"
          ? raw.duration
          : durationUsage(raw.usage);
      return validateTranscriptionResult(
        {
          text: raw.text,
          segments,
          words,
          warnings,
          execution: { kind: "native", calls: 1 },
          ...(language === undefined ? {} : { language }),
          ...(durationInSeconds === undefined ? {} : { durationInSeconds }),
          ...(raw.usage === undefined
            ? {}
            : { providerMetadata: { usage: raw.usage } }),
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

async function uploadable(asset: DataAsset): Promise<Uploadable> {
  return toFile(
    asset.data,
    asset.filename ?? `audio.${extensionFor(asset.mediaType)}`,
    { type: asset.mediaType },
  );
}

function responseFormatFor(
  options: OpenAITranscriptionInput,
): "json" | "verbose_json" | "diarized_json" {
  if (options.diarization) return "diarized_json";
  if (requestedSegments(options) || requestedWords(options))
    return "verbose_json";
  return options.extra?.response_format ?? "json";
}

function timestampGranularities(
  options: OpenAITranscriptionInput,
): readonly ("segment" | "word")[] | undefined {
  if (options.timestamps === "segment") return ["segment"];
  if (options.timestamps === "word") return ["word"];
  if (options.timestamps === "segment-and-word") return ["segment", "word"];
  return undefined;
}

function requestedSegments(options: OpenAITranscriptionInput): boolean {
  return (
    options.diarization === true ||
    options.timestamps === "segment" ||
    options.timestamps === "segment-and-word"
  );
}

function requestedWords(options: OpenAITranscriptionInput): boolean {
  return (
    options.timestamps === "word" || options.timestamps === "segment-and-word"
  );
}

function openAITranscriptionIssue(options: OpenAITranscriptionInput) {
  if (options.task !== undefined && options.task !== "transcribe") {
    return unsupportedControl("transcription.translate", "task");
  }
  if (options.diarization && !options.model.includes("diarize")) {
    return unsupportedControl("transcription.diarization", "diarization");
  }
  if (requestedWords(options) && options.model !== "whisper-1") {
    return unsupportedControl("transcription.timestamps.word", "timestamps");
  }
  if (
    requestedSegments(options) &&
    !options.diarization &&
    options.model !== "whisper-1"
  ) {
    return unsupportedControl("transcription.timestamps.segment", "timestamps");
  }
  if (options.diarization && options.prompt !== undefined) {
    return unsupportedControl("transcription.prompt", "prompt");
  }
  return undefined;
}

function unsupportedControl(capability: string, path: string) {
  return {
    capability,
    path,
    remediation:
      "Choose an OpenAI transcription model that natively supports the requested detail.",
  };
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
