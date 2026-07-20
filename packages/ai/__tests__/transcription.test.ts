import { describe, expect, it, vi } from "vitest";
import { createCruxAi, transcribe } from "../src";
import { transcriptionConformanceRow } from "@use-crux/core/adapter/testing";
import { fallback } from "@use-crux/core";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import type { TranscriptionModel } from "ai";
import { scriptedGateway } from "./scripted-gateway";

const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

describe("AI SDK transcription", () => {
  it("guards and constrains the canonical transcript around one SDK call", async () => {
    const raw = {
      text: "private transcript",
      segments: [{ text: "private transcript", startSecond: 0, endSecond: 1 }],
      warnings: [],
      responses: [],
      providerMetadata: {},
    };
    const scripted = scriptedGateway({ transcribe: [raw] });
    const result = await createCruxAi({ gateway: scripted.gateway }).transcribe(
      {
        model: {} as TranscriptionModel,
        audio: wav,
        guardrails: [
          guardrail({
            id: "ai-transcript-output",
            on: boundary.output.text(),
            run: () => ({
              action: "rewrite",
              value: "guarded transcript",
              rewrite: { kind: "redact" },
            }),
          }),
        ],
        constraints: [
          constraint({
            id: "ai-transcript-constraint",
            on: boundary.output.text(),
            run: (text) => {
              expect(text).toBe("guarded transcript");
              return { pass: true as const };
            },
          }),
        ],
        safety: { tune: { "ai-transcript-output": { mode: "enforce" } } },
      },
    );

    expect(scripted.calls.transcribe).toHaveLength(1);
    expect(scripted.calls.transcribe[0]).not.toHaveProperty("guardrails");
    expect(scripted.calls.transcribe[0]).not.toHaveProperty("constraints");
    expect(scripted.calls.transcribe[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(result).toMatchObject({
      text: "guarded transcript",
      segments: [],
      safety: {
        guardrails: { blocked: false },
        constraints: { allPassed: true },
      },
    });
  });

  it("accepts routing wrappers and sends only the selected leaf model", async () => {
    const scripted = scriptedGateway({
      transcribe: [
        {
          text: "Hello",
          segments: [],
          warnings: [],
          responses: [],
          providerMetadata: {},
        },
      ],
    });
    const first = {
      provider: "test",
      modelId: "audio-a",
    } as TranscriptionModel;
    await createCruxAi({ gateway: scripted.gateway }).transcribe({
      model: fallback([
        first,
        { provider: "test", modelId: "audio-b" } as TranscriptionModel,
      ]),
      audio: wav,
    });
    expect(scripted.calls.transcribe[0]).toMatchObject({ model: first });
  });

  it("performs exactly one native gateway operation and preserves native result facts", async () => {
    expect(transcriptionConformanceRow("ai-sdk").support).toBe("native");
    const scripted = scriptedGateway({
      transcribe: [
        {
          text: "Hello",
          segments: [{ text: "Hello", startSecond: 0, endSecond: 1 }],
          language: "en",
          durationInSeconds: 1,
          warnings: [{ type: "other", message: "native warning" }],
          responses: [{ timestamp: new Date(0), modelId: "audio-model" }],
          providerMetadata: { provider: { requestId: "req_1" } },
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });

    const result = await ai.transcribe({
      model: { provider: "test", modelId: "audio-model" } as never,
      audio: wav,
      extra: { maxRetries: 0, headers: { "x-test": "1" } },
    });

    expect(scripted.calls.transcribe).toHaveLength(1);
    expect(scripted.calls.generateText).toHaveLength(0);
    expect(scripted.calls.generateObject).toHaveLength(0);
    expect(scripted.calls.generateImage).toHaveLength(0);
    expect(scripted.calls.streamText).toHaveLength(0);
    expect(scripted.calls.transcribe[0]).toMatchObject({
      audio: wav,
      maxRetries: 0,
      headers: { "x-test": "1" },
    });
    expect(result).toMatchObject({
      text: "Hello",
      segments: [{ text: "Hello", startSecond: 0, endSecond: 1 }],
      words: [],
      language: "en",
      durationInSeconds: 1,
      providerMetadata: {
        providerMetadata: { provider: { requestId: "req_1" } },
      },
      execution: { kind: "native", calls: 1 },
    });
    expect(result.raw.text).toBe("Hello");
    expect(typeof transcribe).toBe("function");
  });

  it("rejects unproven common language mapping before gateway I/O", async () => {
    const scripted = scriptedGateway();
    await expect(
      createCruxAi({ gateway: scripted.gateway }).transcribe({
        model: { provider: "custom", modelId: "audio" } as never,
        audio: wav,
        language: "en",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(scripted.calls.transcribe).toHaveLength(0);
  });

  it("rejects every unsupported portable detail before gateway I/O", async () => {
    const scripted = scriptedGateway();
    const ai = createCruxAi({ gateway: scripted.gateway });
    const base = {
      model: { provider: "custom", modelId: "audio" } as never,
      audio: wav,
    };
    for (const controls of [
      { task: { type: "translate" as const, targetLanguage: "en" } },
      { timestamps: "segment" as const },
      { diarization: true },
      { prompt: "Names: Crux" },
    ]) {
      await expect(
        ai.transcribe({ ...base, ...controls }),
      ).rejects.toMatchObject({ code: "unsupported_capability" });
    }
    expect(scripted.calls.transcribe).toHaveLength(0);
  });

  it("rejects portable URL materialization with actionable remediation", async () => {
    const scripted = scriptedGateway();

    await expect(
      createCruxAi({ gateway: scripted.gateway }).transcribe({
        model: { provider: "test", modelId: "audio" } as never,
        audio: new URL("https://example.com/audio.wav"),
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      capability: "transcription.url-materialization",
      issues: [
        expect.objectContaining({
          remediation: expect.stringContaining(
            "@use-crux/ai/transcription/node",
          ),
        }),
      ],
    });
    expect(scripted.calls.transcribe).toHaveLength(0);
  });

  it("normalizes data URLs without a Node Buffer global", async () => {
    const scripted = scriptedGateway({
      transcribe: [
        {
          text: "Portable",
          segments: [],
          warnings: [],
          responses: [],
          providerMetadata: {},
        },
      ],
    });
    vi.stubGlobal("Buffer", undefined);

    try {
      await createCruxAi({ gateway: scripted.gateway }).transcribe({
        model: { provider: "test", modelId: "audio" } as never,
        audio: "data:audio/wav;base64,UklGRgAAAABXQVZF",
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(scripted.calls.transcribe[0]?.audio).toEqual(wav);
  });

  it.each([
    ["ArrayBuffer", wav.buffer.slice(0)],
    ["Blob", new Blob([wav], { type: "audio/wav" })],
    [
      "data asset",
      { type: "data" as const, data: wav, mediaType: "audio/wav" },
    ],
  ])("accepts portable %s audio", async (_label, audio) => {
    const scripted = scriptedGateway({
      transcribe: [
        {
          text: "Portable",
          segments: [],
          warnings: [],
          responses: [],
          providerMetadata: {},
        },
      ],
    });

    await createCruxAi({ gateway: scripted.gateway }).transcribe({
      model: { provider: "test", modelId: "audio" } as never,
      audio,
    });

    expect(scripted.calls.transcribe[0]?.audio).toEqual(wav);
  });

  it("rejects unsupported provider-file audio before gateway I/O", async () => {
    const scripted = scriptedGateway();

    await expect(
      createCruxAi({ gateway: scripted.gateway }).transcribe({
        model: { provider: "test", modelId: "audio" } as never,
        audio: {
          type: "provider-file",
          provider: "test",
          fileId: "file_audio",
          mediaType: "audio/wav",
        },
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      capability: "transcription.provider-file",
    });
    expect(scripted.calls.transcribe).toHaveLength(0);
  });

  it("preserves native gateway failures unchanged", async () => {
    const failure = new Error("native failure");
    const scripted = scriptedGateway({ transcribe: [failure] });
    await expect(
      createCruxAi({ gateway: scripted.gateway }).transcribe({
        model: { provider: "test", modelId: "audio" } as never,
        audio: wav,
      }),
    ).rejects.toBe(failure);
  });
});
