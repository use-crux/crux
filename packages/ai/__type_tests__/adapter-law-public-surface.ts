/**
 * Compile-time checks for the `@use-crux/ai` adapter-law public surface.
 */

import type { LanguageModel } from "ai";
import { z } from "zod";
import { prompt, tool, type Prompt } from "@use-crux/core";
import { generate } from "../src";

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

const weather = tool({
  description: "Get weather",
  input: z.object({ city: z.string() }),
  contextSchema: z.object({ apiKey: z.string() }),
  execute: async ({ city }, { context }) => `${city}:${context.apiKey}`,
});

const toolPrompt = prompt({
  id: "ai-tool-context",
  tools: { weather },
  prompt: "Use the tool.",
});

void generate(toolPrompt, {
  model,
  toolsContext: { weather: { apiKey: "secret" } },
});

void generate(toolPrompt, {
  model,
  toolsContext: { weather: { apiKey: "secret" } },
  runtimeContext: { tenantId: "tenant_1" },
  toolApproval: {
    weather: (ctx) => {
      ctx.runtimeContext.tenantId satisfies string;
      // @ts-expect-error - runtimeContext is inferred from the call option.
      ctx.runtimeContext.missing;
      return false;
    },
  },
});

// @ts-expect-error - prompt-level contextSchema makes toolsContext required.
void generate(toolPrompt, { model });

void generate(toolPrompt, {
  model,
  toolsContext: {
    // @ts-expect-error - toolsContext value must match the tool schema.
    weather: { apiKey: 123 },
  },
});
