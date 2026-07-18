import type { LanguageModel } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { executeEvalTaskForInternalUse } from "@use-crux/core/eval/internal/task";
import type { OutputOf } from "@use-crux/core/eval";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

const model = {
  provider: "test",
  modelId: "text-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

describe("generate.task() text output", () => {
  it("keeps the rich production result and projects text for Eval", async () => {
    const scripted = scriptedGateway({
      generateText: [{ text: "Production" }, { text: "Evaluation" }],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model, temperature: 0.2 },
    );

    const production = await task({ topic: "production" });
    const evaluation = await executeEvalTaskForInternalUse(task, {
      topic: "evaluation",
    });

    expect(production.text).toBe("Production");
    expect(production.raw).toBeDefined();
    expect(evaluation.output).toBe("Evaluation");
    expect(evaluation.response.text).toBe("Evaluation");
    expect(scripted.calls.generateText).toHaveLength(2);
    expectTypeOf<OutputOf<typeof task>>().toEqualTypeOf<string>();
  });
});
