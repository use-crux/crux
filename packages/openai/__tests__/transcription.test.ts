import { describe, expect, it, vi } from "vitest";
import { isNoTranscriptError } from "@use-crux/core";
import { fallback } from "@use-crux/core";
import { transcriptionConformanceRow } from "@use-crux/core/adapter/testing";
import { createOpenAI } from "../src";

const wav = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
]);

describe("OpenAI transcription", () => {
  it("accepts routing wrappers and sends only the selected leaf model", async () => {
    const create = vi.fn(async (_body: unknown) => ({ text: "Hello" }));
    await createOpenAI(client(create)).transcribe({
      model: fallback(["whisper-1", "gpt-4o-transcribe"]),
      audio: wav,
    });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "whisper-1" });
  });

  it("performs exactly one native call and normalizes ordered seconds segments", async () => {
    expect(transcriptionConformanceRow("openai").support).toBe("native");
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      text: "Hello world",
      language: "en",
      duration: 1.5,
      segments: [{ id: 0, text: "Hello world", start: 0, end: 1.5 }],
      usage: { type: "duration", seconds: 1.5 },
    }));
    const adapter = createOpenAI(client(create));

    const result = await adapter.transcribe({
      model: "whisper-1",
      audio: wav,
      language: "en",
      prompt: "Product names: Crux",
      timestamps: "segment",
      extra: { transcription: { temperature: 0 } },
    });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: "whisper-1",
      language: "en",
      prompt: "Product names: Crux",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      temperature: 0,
    });
    expect(result).toMatchObject({
      text: "Hello world",
      language: "en",
      durationInSeconds: 1.5,
      segments: [{ text: "Hello world", startSecond: 0, endSecond: 1.5 }],
      words: [],
      providerMetadata: { usage: { type: "duration", seconds: 1.5 } },
      execution: { kind: "native", calls: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/capture|error/i);
    expect(adapter).not.toHaveProperty("experimental");
    expect(adapter).not.toHaveProperty("store");
  });

  it("preserves native API and abort failures unchanged", async () => {
    const providerError = Object.assign(new Error("request aborted"), {
      name: "AbortError",
    });
    const create = vi.fn(async (_body: unknown, _options?: unknown) =>
      Promise.reject(providerError),
    );
    await expect(
      createOpenAI(client(create)).transcribe({
        model: "whisper-1",
        audio: wav,
      }),
    ).rejects.toBe(providerError);
  });

  it("returns an empty segment array with a warning when native timing is absent", async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      text: "Hello",
    }));
    const result = await createOpenAI(client(create)).transcribe({
      model: "whisper-1",
      audio: wav,
      timestamps: "segment",
    });
    expect(result.segments).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining("segments")]);
  });

  it("maps requested native timing and diarization without warning for unrequested detail", async () => {
    const create = vi.fn(async (body: Record<string, unknown>) =>
      body.response_format === "diarized_json"
        ? {
            text: "Hello",
            duration: 1,
            segments: [{ text: "Hello", start: 0, end: 1, speaker: "A" }],
          }
        : { text: "Hello" },
    );
    const adapter = createOpenAI(client(create));

    const plain = await adapter.transcribe({
      model: "gpt-4o-transcribe",
      audio: wav,
    });
    expect(plain.warnings).toEqual([]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      response_format: "json",
    });

    const diarized = await adapter.transcribe({
      model: "gpt-4o-transcribe-diarize",
      audio: wav,
      diarization: true,
    });
    expect(create.mock.calls[1]?.[0]).toMatchObject({
      response_format: "diarized_json",
    });
    expect(diarized.segments).toEqual([
      { text: "Hello", startSecond: 0, endSecond: 1, speaker: "A" },
    ]);
  });

  it("routes supported English translation natively and rejects unsupported detail before I/O", async () => {
    const create = vi.fn(async () => ({ text: "unused" }));
    const translate = vi.fn(async () => ({ text: "Hello" }));
    const adapter = createOpenAI(client(create, translate));
    await expect(
      adapter.transcribe({
        model: "gpt-4o-transcribe",
        audio: wav,
        timestamps: "word",
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    const result = await adapter.transcribe({
      model: "whisper-1",
      audio: wav,
      task: { type: "translate", targetLanguage: "en" },
      prompt: "Crux",
      extra: {
        translation: { temperature: 0.2 },
      },
    });
    expect(result.text).toBe("Hello");
    expect(translate).toHaveBeenCalledWith(
      {
        file: expect.anything(),
        model: "whisper-1",
        prompt: "Crux",
        response_format: "json",
        temperature: 0.2,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects inactive endpoint extra namespaces before I/O", async () => {
    const create = vi.fn(async () => ({ text: "unused" }));
    const translate = vi.fn(async () => ({ text: "unused" }));
    const adapter = createOpenAI(client(create, translate));

    await expect(
      adapter.transcribe({
        model: "whisper-1",
        audio: wav,
        task: { type: "translate", targetLanguage: "en" },
        extra: { transcription: { response_format: "verbose_json" } },
      } as never),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      issues: [expect.objectContaining({ path: "extra.transcription" })],
    });
    await expect(
      adapter.transcribe({
        model: "whisper-1",
        audio: wav,
        task: "transcribe",
        extra: { translation: { temperature: 0.2 } },
      } as never),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      issues: [expect.objectContaining({ path: "extra.translation" })],
    });
    expect(create).not.toHaveBeenCalled();
    expect(translate).not.toHaveBeenCalled();
  });

  it("rejects unsupported provider files before I/O and tags semantic emptiness", async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      text: "  ",
    }));
    const adapter = createOpenAI(client(create));
    await expect(
      adapter.transcribe({
        model: "whisper-1",
        audio: {
          type: "provider-file",
          provider: "openai",
          fileId: "file_1",
          mediaType: "audio/mpeg",
        },
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(create).not.toHaveBeenCalled();

    try {
      await adapter.transcribe({ model: "whisper-1", audio: wav });
      throw new Error("expected failure");
    } catch (error) {
      expect(isNoTranscriptError(error)).toBe(true);
    }
  });
});

function client(create: ReturnType<typeof vi.fn>, translate = vi.fn()) {
  const value = {
    audio: { transcriptions: { create }, translations: { create: translate } },
  };
  Object.defineProperty(value, "storage", {
    get: () => {
      throw new Error("storage must not be read");
    },
  });
  return value as never;
}
