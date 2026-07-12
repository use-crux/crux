import { describe, expect, expectTypeOf, it } from "vitest";
import { generateSpeech as aiGenerateSpeech } from "@use-crux/ai";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { generateSpeech as rootGenerateSpeech } from "../src";
import { Agent, generateSpeech } from "../src/agent";

describe("Convex speech export", () => {
  it("is the exact stateless AI SDK function without an Agent wrapper", () => {
    expect(speechConformanceRow("convex").support).toBe("exact-ai-re-export");
    expect(generateSpeech).toBe(aiGenerateSpeech);
    expect(rootGenerateSpeech).toBe(aiGenerateSpeech);
    expect(Object.hasOwn(Agent.prototype, "generateSpeech")).toBe(false);
    expectTypeOf(generateSpeech).toEqualTypeOf(aiGenerateSpeech);
    expectTypeOf<InstanceType<typeof Agent>>().not.toHaveProperty(
      "generateSpeech",
    );
  });
});
