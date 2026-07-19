import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { transcriptionConformanceRow } from "@use-crux/core/adapter/testing";
import { fallback } from "@use-crux/core";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import { createGoogle } from "../src";

const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

describe("Google transcription", () => {
  it("guards and constrains the canonical transcript around one composed call", async () => {
    const raw = response({ text: "private transcript" });
    const generateContent = vi.fn(async (_args: unknown) => raw);
    const result = await createGoogle(client(generateContent), {
      cachedContent: false,
    }).transcribe({
      model: "gemini-2.5-flash",
      audio: wav,
      guardrails: [
        guardrail({
          id: "google-transcript-output",
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
          id: "google-transcript-constraint",
          on: boundary.output.text(),
          run: (text) => {
            expect(text).toBe("guarded transcript");
            return { pass: true as const };
          },
        }),
      ],
      safety: { tune: { "google-transcript-output": { mode: "enforce" } } },
    });

    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0]?.[0]).not.toHaveProperty("guardrails");
    expect(generateContent.mock.calls[0]?.[0]).not.toHaveProperty(
      "constraints",
    );
    expect(generateContent.mock.calls[0]?.[0]).not.toHaveProperty("safety");
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
    const generateContent = vi.fn(async (_args: unknown) =>
      response({ text: "Hello" }),
    );
    await createGoogle(client(generateContent), {
      cachedContent: false,
    }).transcribe({
      model: fallback(["gemini-2.5-flash", "custom-audio-model"]),
      audio: wav,
    });
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-2.5-flash",
    });
    const request = generateContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: Array<{ text?: string }> }>;
      config: { responseJsonSchema: { properties: Record<string, unknown> } };
    };
    expect(request.contents[0]?.parts[0]?.text).not.toMatch(/timing|segment/i);
    expect(request.config.responseJsonSchema.properties).not.toHaveProperty(
      "segments",
    );
  });

  it("uses one composed native call with audio and a fixed structured transcript route", async () => {
    const raw = response({
      text: "Hello",
      language: "en",
      segments: [{ text: "Hello", start: 0, end: 1 }],
    });
    const generateContent = vi.fn(async (_args: unknown) => raw);
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });

    const result = await google.transcribe({
      model: "gemini-2.5-flash",
      audio: wav,
      extra: { temperature: 0 },
    });

    expect(transcriptionConformanceRow("google").support).toBe("composed");
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { text: expect.stringContaining("Transcribe only") },
            { inlineData: { mimeType: "audio/wav" } },
          ],
        },
      ],
      config: {
        temperature: 0,
        abortSignal: expect.any(AbortSignal),
        responseMimeType: "application/json",
        responseJsonSchema: { required: ["text"] },
      },
    });
    expect(result.segments).toEqual([]);
    expect(result.words).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("composed")]);
    expect(result.execution).toEqual({
      kind: "composed",
      calls: 1,
      operations: ["generation.call"],
    });
    expect(result.raw).toBe(raw);
    expectTypeOf(google.transcribe).toBeFunction();
  });

  it("rejects every timestamp request before composed provider I/O", async () => {
    const generateContent = vi.fn(async () =>
      response({
        text: "Hello",
        segments: [{ text: "Hello", start: 2, end: 1 }],
      }),
    );
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });
    for (const timestamps of ["segment", "word", "segment-and-word"] as const) {
      await expect(
        google.transcribe({
          model: "custom-audio-model",
          audio: wav,
          timestamps,
        }),
      ).rejects.toMatchObject({ code: "unsupported_capability" });
    }
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("does not warn for unrequested timing and rejects unsupported requested detail before I/O", async () => {
    const generateContent = vi.fn(async () => response({ text: "Hello" }));
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });
    const plain = await google.transcribe({
      model: "gemini-2.5-flash",
      audio: wav,
    });
    expect(plain.warnings).toEqual([expect.stringContaining("composed")]);

    await expect(
      google.transcribe({
        model: "gemini-2.5-flash",
        audio: wav,
        timestamps: "segment",
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    await expect(
      google.transcribe({
        model: "gemini-2.5-flash",
        audio: wav,
        diarization: true,
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    await expect(
      google.transcribe({
        model: "gemini-2.5-flash",
        audio: wav,
        task: { type: "translate", targetLanguage: "en" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("rejects known unsupported models before I/O and preserves native errors", async () => {
    const generateContent = vi.fn(async () => response({ text: "x" }));
    const google = createGoogle(client(generateContent), {
      cachedContent: false,
    });
    await expect(
      google.transcribe({ model: "imagen-4.0-generate-001", audio: wav }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    expect(generateContent).not.toHaveBeenCalled();

    const providerError = new Error("native failure");
    generateContent.mockRejectedValueOnce(providerError);
    await expect(
      google.transcribe({ model: "custom-audio-model", audio: wav }),
    ).rejects.toBe(providerError);
  });
});

function client(generateContent: ReturnType<typeof vi.fn>): GoogleGenAI {
  return { models: { generateContent } } as never;
}

function response(value: unknown) {
  return {
    text: JSON.stringify(value),
    responseId: "resp_1",
    modelVersion: "gemini-test",
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    },
  };
}
