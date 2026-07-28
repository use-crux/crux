import type OpenAI from "openai";
import {
  createUnsupportedCapabilityError,
  validateGenerateSpeechOptions,
  type StreamSpeech,
  type StreamSpeechResult,
} from "@use-crux/core";
import { defineStreamingOperation } from "@use-crux/core/adapter";
import {
  openAISpeechIssue,
  type OpenAISpeechExtra,
  type OpenAISpeechInput,
  type OpenAISpeechVoice,
} from "./speech";
import {
  decodeOpenAISpeechStreamCompletion,
  openOpenAISpeechStream,
} from "./speech-streaming-source";

const OPENAI_SPEECH_STREAM_MODELS = new Set([
  "tts-1",
  "tts-1-hd",
  "gpt-4o-mini-tts",
  "gpt-4o-mini-tts-2025-12-15",
]);

/** OpenAI streaming extras; Crux owns the native binary stream mode. */
export type OpenAISpeechStreamExtra = OpenAISpeechExtra;

type OpenAISpeechStreamInput = OpenAISpeechInput;

/** Exact completed result of an OpenAI Speech API body stream. */
export type OpenAIStreamSpeechResult = StreamSpeechResult<
  Response,
  never,
  never
>;

/**
 * Genuine OpenAI speech byte stream attached to a bound adapter.
 *
 * Append `audio-delta` bytes in sequence order for progressive playback. The
 * deltas remain provisional and enforcing output-media Safety may retain them
 * until the assembled final audio passes validation. Every `fullStream` reader
 * replays one in-memory history; returning from a reader only detaches it,
 * while `cancel()` aborts the operation. The first published event commits
 * routing. The final `audio` event and `completion.audio` share one validated
 * asset, which Crux never persists implicitly.
 *
 * @example
 * ```ts
 * const result = await openai.streamSpeech({
 *   model: 'gpt-4o-mini-tts',
 *   text: 'Welcome aboard',
 *   voice: 'alloy',
 *   outputFormat: 'mp3',
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'audio-delta') player.append(event.data)
 * }
 *
 * const { audio } = await result.completion
 * ```
 */
export type OpenAIStreamSpeech = StreamSpeech<
  string,
  OpenAISpeechVoice,
  OpenAISpeechStreamExtra,
  Response,
  never,
  never
>;

/** Define native OpenAI Speech API response-body streaming mechanics. */
export function createOpenAISpeechStreamingOperation(client: OpenAI) {
  return defineStreamingOperation({
    normalize(input: OpenAISpeechStreamInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateSpeechOptions(options);
      const issue = openAISpeechIssue(options);
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: "openai",
          model: context.model,
          issues: [issue],
        });
      }
      return options;
    },
    support: (options) =>
      OPENAI_SPEECH_STREAM_MODELS.has(String(options.model))
        ? ("supported" as const)
        : ("unsupported" as const),
    open: (options, { signal, call }) =>
      openOpenAISpeechStream(client, options, signal, call),
    validate: (native, options) =>
      decodeOpenAISpeechStreamCompletion(native, options),
    report: (result) => ({ kind: "audio" as const, size: result.audio.size }),
    conformance: [],
  });
}
