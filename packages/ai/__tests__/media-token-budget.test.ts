import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { prompt } from "@use-crux/core";
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '@use-crux/core/observability'
import { createCruxAi } from '../src'
import { estimateAiSdkMediaTokens } from '../src/media-preflight'
import { scriptedGateway } from './scripted-gateway'

const textPrompt = prompt({ id: 'ai-media-token-budget', prompt: 'Inspect.' })

afterEach(() => resetObservabilityRuntime())

describe("AI SDK media token budgeting", () => {
  it("uses stable provider/model identity without direct adapter imports", () => {
    expect(
      estimateAiSdkMediaTokens({
        provider: "anthropic.messages",
        model: "clau" + "de-sonnet-4-5",
        media: { kind: "image", width: 800, height: 600 },
      }),
    ).toBe(640);
    expect(
      estimateAiSdkMediaTokens({
        model: "google/gemini-2.5-flash",
        media: { kind: "file", mediaType: "audio/mpeg", durationInSeconds: 10 },
      }),
    ).toBe(320);
    expect(
      estimateAiSdkMediaTokens({
        provider: "custom-provider",
        model: "custom-model",
        media: { kind: "image", width: 800, height: 600 },
      }),
    ).toBeUndefined();
  });

  it.each(["generate", "stream"] as const)(
    "applies the same safe estimate to %s",
    async (mode) => {
      const transport = createInMemoryObservabilityTransport();
      setObservabilityTransport(transport, { scheduledDelayMs: 0 });
      const scripted = scriptedGateway({
        generateText: [{ text: "done" }],
        streamText: [{ chunks: ["done"] }],
      });
      const ai = createCruxAi({ gateway: scripted.gateway });
      const options = {
        model: model("custom-model", "custom-provider"),
        messages: [
          {
            role: "user" as const,
            content: [
              {
                type: "image" as const,
                source: new Uint8Array([1, 2, 3]),
                mediaType: "image/png",
              },
            ],
          },
        ],
        inputBudget: { max: 10_000 },
      };

    if (mode === 'generate') await ai.generate(textPrompt, options)
    else await ai.stream(textPrompt, options)
    await observe.flush()

      expect(transport.records).toContainEqual(
        expect.objectContaining({
          type: "span:event",
          name: "input.tokens.estimated",
          attributes: expect.objectContaining({
            estimatedMediaTokens: expect.any(Number),
            estimateUsedFallback: true,
            mediaEstimateReason: "deterministic-fallback",
          }),
        }),
      );
    },
  );

  it("honors public inputBudget before live AI SDK dispatch", async () => {
    const doGenerate = vi.fn(async () => {
      throw new Error("provider dispatch must not run");
    });
    const liveModel = new MockLanguageModelV3({
      provider: "openai",
      modelId: "gpt-4o",
      doGenerate,
    }) as unknown as LanguageModel;

    await expect(
      createCruxAi().generate(textPrompt, {
        model: liveModel,
        inputBudget: { max: 1 },
      }),
    ).rejects.toMatchObject({ cause: { code: "REQUEST_TOO_LARGE" } });
    expect(doGenerate).not.toHaveBeenCalled();
  });
});

function model(modelId: string, provider: string): LanguageModel {
  return { provider, modelId, specificationVersion: 'v3' } as unknown as LanguageModel
}
