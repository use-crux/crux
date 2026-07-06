/**
 * Compile-time checks for the `@use-crux/ai` adapter-law public surface.
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Prompt } from "@use-crux/core";
import { generate } from "../index";

declare const model: LanguageModel;
declare const textPrompt: Prompt<
  z.ZodObject<{ instruction: z.ZodString }>,
  undefined,
  []
>;

void generate(textPrompt, {
  model,
  input: { instruction: "portable" },
  maxTokens: 512,
  topK: 40,
  stopSequences: ["END"],
  seed: 123,
  activeTools: ["search"],
  extra: {
    maxRetries: 2,
    headers: { "x-crux-test": "yes" },
    providerOptions: { openai: { store: false } },
  },
});

void generate(textPrompt, {
  model,
  input: { instruction: "portable" },
  // @ts-expect-error - AI SDK maxOutputTokens is replaced by canonical maxTokens.
  maxOutputTokens: 512,
});

void generate(textPrompt, {
  model,
  input: { instruction: "portable" },
  // @ts-expect-error - AI SDK providerOptions belongs in extra.providerOptions.
  providerOptions: { openai: { store: false } },
});

void generate(textPrompt, {
  model,
  input: { instruction: "portable" },
  // @ts-expect-error - AI SDK headers belongs in extra.headers.
  headers: { "x-crux-test": "yes" },
});
