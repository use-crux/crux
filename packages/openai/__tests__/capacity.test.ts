import { describe, expect, it } from "vitest";
import {
  createOpenAI,
  openAIModelCapacity,
} from "../src";
import type OpenAI from "openai";

describe("OpenAI model capacity", () => {
  it("reports known model families through the adapter", () => {
    const runtime = createOpenAI({} as OpenAI);

    expect(runtime.capacity("gpt-4o")).toEqual({
      contextWindow: 128_000,
      defaultOutputReserve: 16_384,
      countingConfidence: "estimated",
    });
    expect(runtime.capacity("gpt-5-mini-2026-01-01").contextWindow).toBe(
      400_000,
    );
  });

  it("uses the provider fallback for an unknown model", () => {
    expect(openAIModelCapacity("future-model")).toEqual({
      contextWindow: 16_384,
      defaultOutputReserve: 4_096,
      countingConfidence: "conservative",
    });
  });
});
