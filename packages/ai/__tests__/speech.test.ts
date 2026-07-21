import { describe, expect, expectTypeOf, it } from "vitest";
import type { SpeechModel } from "ai";
import { speechConformanceRow } from "@use-crux/core/adapter/testing";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createCruxAi, generateSpeech } from "../src";
import { scriptedGateway } from "./scripted-gateway";

describe("AI SDK speech", () => {
  it("guards speech options without leaking policy controls into the SDK call", async () => {
    const raw = {
      audio: {
        uint8Array: new Uint8Array([1, 2, 3]),
        base64: "AQID",
        mediaType: "audio/wav",
        format: "wav",
      },
      warnings: [],
      responses: [],
      providerMetadata: {},
    };
    const scripted = scriptedGateway({ generateSpeech: [raw] });
    const result = await createCruxAi({
      gateway: scripted.gateway,
    }).generateSpeech({
      model: {} as SpeechModel,
      text: "private speech",
      guardrails: [
        guardrail({
          id: "ai-speech-input",
          on: boundary.input.text(),
          run: () => ({
            action: "rewrite",
            value: "guarded speech",
            rewrite: { kind: "redact" },
          }),
        }),
        guardrail({
          id: "ai-speech-output",
          on: boundary.output.media(),
          run: () => ({ action: "allow" }),
        }),
      ],
      safety: { tune: { "ai-speech-output": { mode: "report" } } },
    });

    expect(scripted.calls.generateSpeech[0]).toMatchObject({
      text: "guarded speech",
    });
    expect(scripted.calls.generateSpeech[0]).not.toHaveProperty("guardrails");
    expect(scripted.calls.generateSpeech[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(
      result.safety?.guardrails?.applied.map((entry) => entry.guard),
    ).toEqual(["ai-speech-input", "ai-speech-output"]);
  });

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

  it("keeps top-level portable fields authoritative over runtime-cast extras", async () => {
    const scripted = scriptedGateway();
    const ai = createCruxAi({ gateway: scripted.gateway });
    const model = { provider: "custom", modelId: "voice-1" } as SpeechModel;

    await ai.generateSpeech({
      model,
      text: "Canonical",
      voice: "alloy",
      extra: {
        model: { provider: "evil", modelId: "shadow" },
        text: "Shadow",
        voice: "shadow",
        abortSignal: new AbortController().signal,
        maxRetries: 0,
      },
    } as never);

    expect(scripted.calls.generateSpeech[0]).toMatchObject({
      model,
      text: "Canonical",
      voice: "alloy",
      maxRetries: 0,
    });
  });
});
