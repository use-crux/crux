import type { LanguageModel } from "ai";
import { expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { evalContext } from "@use-crux/core/eval";
import { executeEvalTaskForInternalUse } from "@use-crux/core/eval/internal/task";
import { withEvalContext } from "@use-crux/core/eval/testing";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

function model(): LanguageModel {
  return {
    provider: "openai",
    modelId: "gpt-4o",
    specificationVersion: "v3",
  } as unknown as LanguageModel;
}

/** Register managed-task propagation of the exact Eval execution context. */
export function generateEvalTaskContextBehavior(): void {
  it("forwards the managed Eval context without mutating authored call data", async () => {
    const scripted = scriptedGateway({
      generateText: [{ text: "context-aware" }],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).generate.task(
      prompt({
        input: z.object({ question: z.string() }),
        prompt: ({ input }) => input.question,
      }),
      { model: model(), temperature: 0.2 },
    );
    const controller = new AbortController();
    const authoredCall = { temperature: 0.4 };
    let activeTimeout: ReturnType<typeof evalContext>["timeout"] | undefined;

    await withEvalContext(
      {
        signal: controller.signal,
        timeout: { stepMs: null, tools: { search: null } },
      },
      async () => {
        activeTimeout = evalContext().timeout;
        await executeEvalTaskForInternalUse(
          task,
          { question: "Refund?" },
          authoredCall,
        );
      },
    );

    expect(scripted.calls.generateText[0]?.abortSignal).toBe(controller.signal);
    expect(authoredCall).toEqual({ temperature: 0.4 });
    expect(authoredCall).not.toHaveProperty("signal");
    expect(authoredCall).not.toHaveProperty("timeout");
    expect(activeTimeout).toEqual({
      stepMs: null,
      tools: { search: null },
    });
    expect(Object.isFrozen(activeTimeout)).toBe(true);
  });
}
