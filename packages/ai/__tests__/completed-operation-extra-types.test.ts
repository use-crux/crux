import { expectTypeOf, it } from "vitest";
import type { AISpeechExtra } from "../src";

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
});
