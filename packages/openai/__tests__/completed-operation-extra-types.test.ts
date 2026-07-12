import { expectTypeOf, it } from "vitest";
import type { OpenAISpeechExtra, OpenAITranslationExtra } from "../src";

it("keeps OpenAI completed-operation extras endpoint-specific", () => {
  const translation = { temperature: 0 } satisfies OpenAITranslationExtra;
  expectTypeOf(translation.temperature).toEqualTypeOf<number>();

  // @ts-expect-error translation does not accept transcription chunking controls.
  const chunking: OpenAITranslationExtra = { chunking_strategy: "auto" };
  // @ts-expect-error bounded speech does not expose the SSE stream format.
  const sse: OpenAISpeechExtra = { stream_format: "sse" };
  expectTypeOf(chunking).toMatchTypeOf<OpenAITranslationExtra>();
  expectTypeOf(sse).toMatchTypeOf<OpenAISpeechExtra>();
});
