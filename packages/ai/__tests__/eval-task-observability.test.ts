import type { LanguageModel } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { prompt } from "@use-crux/core";
import { executeObservedEvalTaskForInternalUse } from "@use-crux/core/eval/internal/runner";
import { createCruxAi } from "../src";
import { scriptedGateway } from "./scripted-gateway";

const model = {
  provider: "test",
  modelId: "observed-model",
  specificationVersion: "v3",
} as unknown as LanguageModel;

describe.each(["generate", "stream"] as const)(
  "%s.task observability",
  (operation) => {
    it("returns the authoritative run link and observed signal families", async () => {
      const scripted = scriptedGateway(
        operation === "generate"
          ? { generateText: [{ text: "done" }] }
          : { streamText: [{ chunks: ["done"] }] },
      );
      const ai = createCruxAi({ gateway: scripted.gateway });
      const task = ai[operation].task(
        prompt({
          input: z.object({ topic: z.string() }),
          prompt: ({ input }) => input.topic,
        }),
        { model },
      );

      const result = await executeObservedEvalTaskForInternalUse({
        evalId: "observability",
        caseId: operation,
        variant: "current",
        trial: 0,
        task,
        overrides: {},
        input: { topic: operation },
      });

      expect(result.response).toBeDefined();
      expect(result.runIds).toEqual([result.response!.runId]);
      expect(result.response?._meta).toMatchObject({
        traceId: expect.stringMatching(/^[0-9a-f]{32}$/u),
        spanId: expect.stringMatching(/^[0-9a-f]{16}$/u),
      });
      expect(result.capturedSignals).toContain("modelCalls");
      expect(result.renderedPromptFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    });
  },
);
