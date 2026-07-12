import { describe, expect, expectTypeOf, it } from "vitest";
import type { SpeechModel } from "ai";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { createCruxAi, generateSpeech } from "../src";
import { scriptedGateway } from "./scripted-gateway";

describe("AI SDK speech", () => {
  it("exports an unbound runner-backed native speech operation", async () => {
    expect(speechConformanceRow("ai-sdk").support).toBe("native");
    const raw = {
      audio: {
        uint8Array: new Uint8Array([1, 2, 3]),
        base64: "AQID",
        mediaType: "audio/wav",
        format: "wav",
      },
      warnings: [{ type: "other", message: "native warning" }],
      responses: [{ modelId: "speech-model" }],
      providerMetadata: { provider: { requestId: "req-1" } },
    };
    const scripted = scriptedGateway({ generateSpeech: [raw] });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const model = { provider: "custom", modelId: "voice-1" } as SpeechModel;

    const result = await ai.generateSpeech({
      model,
      text: "Hello",
      voice: "alloy",
      outputFormat: "wav",
      instructions: "Warmly",
      speed: 1.2,
      language: "en",
      extra: { maxRetries: 0, providerOptions: { custom: { temperature: 0 } } },
    });

    expect(scripted.calls.generateSpeech).toEqual([
      expect.objectContaining({
        model,
        text: "Hello",
        voice: "alloy",
        outputFormat: "wav",
        maxRetries: 0,
      }),
    ]);
    expect(result.raw).toBe(raw);
    expect(result.audio).toMatchObject({
      type: "data",
      mediaType: "audio/wav",
    });
    expect(result.providerMetadata).toEqual({
      responses: raw.responses,
      providerMetadata: raw.providerMetadata,
    });
    expect(result.warnings).toEqual(raw.warnings);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expectTypeOf(generateSpeech).toBeFunction();
  });
});
