import { expectTypeOf, it } from "vitest";
import type {
  AIGenerateImage,
  AIGenerateSpeech,
  AISpeechExtra,
  AITranscribe,
} from "../src";
import { createAiSdkImageOperation } from "../src/image-generation";
import { createAiSdkSpeechOperation } from "../src/speech";
import { createAiSdkTranscriptionOperation } from "../src/transcription";

type AIImagePayload = ReturnType<
  ReturnType<typeof createAiSdkImageOperation>["validate"]
>;
type AITranscriptionPayload = ReturnType<
  ReturnType<typeof createAiSdkTranscriptionOperation>["validate"]
>;
type AISpeechPayload = ReturnType<
  ReturnType<typeof createAiSdkSpeechOperation>["validate"]
>;

it("reserves portable AI SDK speech keys for the top-level contract", () => {
  const native = {
    maxRetries: 0,
    providerOptions: { openai: {} },
    headers: { "x-test": "yes" },
  } satisfies AISpeechExtra;
  expectTypeOf(native).toMatchTypeOf<AISpeechExtra>();

  // @ts-expect-error model is owned by the top-level speech option.
  const model: AISpeechExtra = { model: "shadow" };
  // @ts-expect-error text is owned by the top-level speech option.
  const text: AISpeechExtra = { text: "shadow" };
  // @ts-expect-error abortSignal is owned by the shared runner.
  const signal: AISpeechExtra = { abortSignal: new AbortController().signal };
  expectTypeOf(model).toMatchTypeOf<AISpeechExtra>();
  expectTypeOf(text).toMatchTypeOf<AISpeechExtra>();
  expectTypeOf(signal).toMatchTypeOf<AISpeechExtra>();

  if (false) {
    const imagePayload = {} as AIImagePayload;
    const transcriptionPayload = {} as AITranscriptionPayload;
    const speechPayload = {} as AISpeechPayload;
    // @ts-expect-error provider image validation returns an ID-free payload.
    imagePayload._meta;
    // @ts-expect-error provider transcription validation returns an ID-free payload.
    transcriptionPayload._meta;
    // @ts-expect-error provider speech validation returns an ID-free payload.
    speechPayload._meta;

    void ({} as Awaited<ReturnType<AIGenerateImage>>)._meta.traceId;
    void ({} as Awaited<ReturnType<AITranscribe>>)._meta.spanId;
    void ({} as Awaited<ReturnType<AIGenerateSpeech>>)._meta.traceId;
  }
});
