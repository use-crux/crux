import { expectTypeOf, it } from "vitest";
import type {
  OpenAIGenerateImage,
  OpenAIGenerateSpeech,
  OpenAISpeechExtra,
  OpenAITranscribe,
  OpenAITranslationExtra,
} from "../src";
import type OpenAI from "openai";
import { createOpenAI } from "../src";
import { createOpenAIImageOperation } from "../src/image-generation";
import { createOpenAISpeechOperation } from "../src/speech";
import { createOpenAITranscriptionOperation } from "../src/transcription";

type OpenAIImagePayload = ReturnType<
  ReturnType<typeof createOpenAIImageOperation>["validate"]
>;
type OpenAITranscriptionPayload = ReturnType<
  ReturnType<typeof createOpenAITranscriptionOperation>["validate"]
>;
type OpenAISpeechPayload = ReturnType<
  ReturnType<typeof createOpenAISpeechOperation>["validate"]
>;

it("keeps OpenAI completed-operation extras endpoint-specific", () => {
  const translation = { temperature: 0 } satisfies OpenAITranslationExtra;
  expectTypeOf(translation.temperature).toEqualTypeOf<number>();

  // @ts-expect-error translation does not accept transcription chunking controls.
  const chunking: OpenAITranslationExtra = { chunking_strategy: "auto" };
  // @ts-expect-error bounded speech does not expose the SSE stream format.
  const sse: OpenAISpeechExtra = { stream_format: "sse" };
  expectTypeOf(chunking).toMatchTypeOf<OpenAITranslationExtra>();
  expectTypeOf(sse).toMatchTypeOf<OpenAISpeechExtra>();
  // @ts-expect-error endpoint namespaces are mutually exclusive.
  const both: import("../src").OpenAITranscriptionExtra = {
    transcription: { temperature: 0 },
    translation: { temperature: 0 },
  };
  expectTypeOf(both).toMatchTypeOf<import("../src").OpenAITranscriptionExtra>();

  const adapter = createOpenAI({} as OpenAI);
  if (false) {
    adapter.transcribe({
      model: "whisper-1",
      audio: new Uint8Array([1]),
      task: { type: "translate", targetLanguage: "en" },
      // @ts-expect-error endpoint extras must use the translation/transcription keys.
      extra: { chunking_strategy: "auto" },
    });

    const imagePayload = {} as OpenAIImagePayload;
    const transcriptionPayload = {} as OpenAITranscriptionPayload;
    const speechPayload = {} as OpenAISpeechPayload;
    // @ts-expect-error provider image validation returns an ID-free payload.
    imagePayload._meta;
    // @ts-expect-error provider transcription validation returns an ID-free payload.
    transcriptionPayload._meta;
    // @ts-expect-error provider speech validation returns an ID-free payload.
    speechPayload._meta;
    void ({} as Awaited<ReturnType<OpenAIGenerateImage>>)._meta.traceId;
    void ({} as Awaited<ReturnType<OpenAITranscribe>>)._meta.spanId;
    void ({} as Awaited<ReturnType<OpenAIGenerateSpeech>>)._meta.traceId;
  }
});
