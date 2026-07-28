import type { GenerateContentResponse, GoogleGenAI } from "@google/genai";
import {
  createUnsupportedCapabilityError,
  validateGenerateSpeechOptions,
  type StreamSpeech,
  type StreamSpeechResult,
} from "@use-crux/core";
import { defineStreamingOperation } from "@use-crux/core/adapter";
import {
  googleSpeechIssue,
  type GoogleSpeechExtra,
  type GoogleSpeechInput,
  type GoogleSpeechVoice,
} from "./speech";
import {
  decodeGoogleSpeechStreamCompletion,
  openGoogleSpeechStream,
} from "./speech-streaming-source";

const GOOGLE_SPEECH_STREAM_MODEL = "gemini-3.1-flash-tts-preview";

/** Exact completed result of a finite Google Generate Content TTS stream. */
export type GoogleStreamSpeechResult = StreamSpeechResult<
  GenerateContentResponse,
  never,
  never
>;

/**
 * Genuine Google raw-PCM speech stream attached to a bound adapter.
 *
 * Append each `audio-delta` in sequence order using its exact native MIME.
 * Deltas contain headerless 24 kHz mono 16-bit PCM and may be retained by
 * enforcing output-media Safety until Google returns a successful terminal
 * response. The final audio shares identity with `completion.audio`; Crux
 * never adds a WAV header or persists it implicitly. Every `fullStream` reader
 * replays one in-memory history; returning from one reader only detaches it,
 * while `cancel()` aborts the operation. The first published event commits
 * routing.
 *
 * @example
 * ```ts
 * const result = await google.streamSpeech({
 *   model: 'gemini-3.1-flash-tts-preview',
 *   text: 'Welcome aboard',
 *   voice: 'Kore',
 * })
 *
 * for await (const event of result.fullStream) {
 *   if (event.type === 'audio-delta') pcmPlayer.append(event.data)
 * }
 *
 * await assetStore.put((await result.completion).audio)
 * ```
 */
export type GoogleStreamSpeech = StreamSpeech<
  string,
  GoogleSpeechVoice,
  GoogleSpeechExtra,
  GenerateContentResponse,
  never,
  never
>;

/** Define finite Google Generate Content TTS streaming mechanics. */
export function createGoogleSpeechStreamingOperation(client: GoogleGenAI) {
  return defineStreamingOperation({
    normalize(input: GoogleSpeechInput, context) {
      const options = { ...input, model: context.model };
      validateGenerateSpeechOptions(options);
      const issue = googleSpeechIssue(options);
      if (issue) {
        throw createUnsupportedCapabilityError({
          adapter: "google",
          model: context.model,
          issues: [issue],
        });
      }
      return options;
    },
    support: (options) =>
      options.model === GOOGLE_SPEECH_STREAM_MODEL
        ? ("supported" as const)
        : ("unsupported" as const),
    open: (options, { signal, call }) =>
      openGoogleSpeechStream(client, options, signal, call),
    validate: decodeGoogleSpeechStreamCompletion,
    report: (result) => ({ kind: "audio" as const, size: result.audio.size }),
    conformance: [],
  });
}
