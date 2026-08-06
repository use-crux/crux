import { prompt, type AnyToolSet } from "@use-crux/core";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";

import { createCruxAi, aiSdk } from "../../../src";
import { effectfulContext, pureContext, schemaTools } from "./contexts";

const result = {
  content: [{ type: "text", text: "run" }],
  finishReason: { unified: "stop", raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1 },
    outputTokens: { total: 1, text: 1 },
  },
  warnings: [],
};

function model() {
  return aiSdk(
    new MockLanguageModelV3({
      provider: "openai",
      modelId: "gpt-4o",
      doGenerate: async () => result as never,
    }),
  );
}

function task(use: readonly (typeof pureContext)[], tools?: AnyToolSet) {
  return createCruxAi().generate.task(
    prompt({
      input: z.object({ question: z.string() }),
      use,
      prompt: "run",
      ...(tools === undefined ? {} : { tools }),
    }),
    { model: model() },
  );
}

export const pureTask = task([pureContext], schemaTools);
export const effectfulToolTask = task([pureContext], {
  mutate: {
    inputSchema: z.object({ value: z.string() }),
    execute: async ({ value }: { value: string }) => value,
  },
});
export const effectfulContextTask = task([effectfulContext]);
