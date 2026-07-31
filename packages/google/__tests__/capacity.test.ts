import { describe, expect, it } from "vitest";
import { GoogleGenAI } from "@google/genai";
import {
  createGoogle,
  googleModelCapacity,
} from "../src";

describe("Google model capacity", () => {
  it("reports known model families through the adapter", () => {
    const runtime = createGoogle(new GoogleGenAI({ apiKey: "test" }));

    expect(runtime.capacity("gemini-2.5-flash")).toEqual({
      contextWindow: 1_048_576,
      defaultOutputReserve: 65_536,
      countingConfidence: "estimated",
    });
    expect(runtime.capacity("gemini-3-pro-preview").contextWindow).toBe(
      1_048_576,
    );
  });

  it("uses the provider fallback for an unknown model", () => {
    expect(googleModelCapacity("future-model")).toEqual({
      contextWindow: 32_768,
      defaultOutputReserve: 8_192,
      countingConfidence: "conservative",
    });
  });
});
