import { describe, expect, it } from "vitest";
import type { LanguageModel } from "ai";
import {
  aiSdkModelCapacity,
  createCruxAi,
} from "../src";
import type { SdkGateway } from "../src/gateway";

const openAIModel = {
  provider: "openai",
  modelId: "gpt-4o",
} as LanguageModel;

describe("AI SDK model capacity", () => {
  it("reports known provider model families through the adapter", () => {
    const runtime = createCruxAi({ gateway: {} as SdkGateway });

    expect(runtime.capacity(openAIModel)).toEqual({
      contextWindow: 128_000,
      defaultOutputReserve: 16_384,
      countingConfidence: "estimated",
    });
  });

  it("uses a conservative fallback for an unknown provider model", () => {
    expect(
      aiSdkModelCapacity({
        provider: "custom",
        modelId: "future-model",
      }),
    ).toEqual({
      contextWindow: 8_192,
      defaultOutputReserve: 2_048,
      countingConfidence: "conservative",
    });
  });
});
