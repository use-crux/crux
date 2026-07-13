import { describe, expect, expectTypeOf, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { createAnthropic } from "../src";

describe("Anthropic speech support boundary", () => {
  it("omits generateSpeech structurally at type and runtime levels", () => {
    const adapter = createAnthropic({} as Anthropic);
    expect(speechConformanceRow("anthropic").support).toBe("absent");
    expect(Object.hasOwn(adapter, "generateSpeech")).toBe(false);
    expectTypeOf(adapter).not.toHaveProperty("generateSpeech");
  });
});
