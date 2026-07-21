import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ImageModel } from "ai";
import { imageGenerationConformanceRow } from "@use-crux/core/adapter/testing";
import { fallback } from "@use-crux/core";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createCruxAi, generateImage, type SdkGateway } from "../src";

function imageGateway(raw: unknown): {
  gateway: SdkGateway;
  image: ReturnType<typeof vi.fn>;
  text: ReturnType<typeof vi.fn>;
  stream: ReturnType<typeof vi.fn>;
} {
  const image = vi.fn(async (_args: unknown) => raw);
  const text = vi.fn();
  const stream = vi.fn();
  const unused = vi.fn();
  return {
    gateway: {
      generateImage: image as SdkGateway["generateImage"],
      generateSpeech: unused as SdkGateway["generateSpeech"],
      transcribe: unused as SdkGateway["transcribe"],
      generateText: text as SdkGateway["generateText"],
      generateObject: unused as SdkGateway["generateObject"],
      streamText: stream as SdkGateway["streamText"],
      streamObject: unused as SdkGateway["streamObject"],
      embedMany: unused as SdkGateway["embedMany"],
      rerank: unused as SdkGateway["rerank"],
    },
    image,
    text,
    stream,
  };
}

describe("AI SDK image generation", () => {
  it("guards public options around the native payload and canonical result", async () => {
    const file = {
      base64: "AQI=",
      uint8Array: new Uint8Array([1, 2]),
      mediaType: "image/png",
    };
    const raw = {
      image: file,
      images: [file],
      warnings: [],
      responses: [],
      providerMetadata: {},
      usage: {},
    };
    const scripted = imageGateway(raw);
    const result = await createCruxAi({
      gateway: scripted.gateway,
    }).generateImage({
      model: {} as ImageModel,
      prompt: "private prompt",
      guardrails: [
        guardrail({
          id: "ai-image-input",
          on: boundary.input.text(),
          run: () => ({
            action: "rewrite",
            value: "guarded prompt",
            rewrite: { kind: "redact" },
          }),
        }),
        guardrail({
          id: "ai-image-output",
          on: boundary.output.media(),
          run: () => ({ action: "warn", reason: "Review image." }),
        }),
      ],
      safety: { tune: { "ai-image-output": { mode: "report" } } },
    });

    expect(scripted.image.mock.calls[0]?.[0]).toMatchObject({
      prompt: "guarded prompt",
    });
    expect(scripted.image.mock.calls[0]?.[0]).not.toHaveProperty("guardrails");
    expect(scripted.image.mock.calls[0]?.[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(result.safety?.guardrails?.applied).toEqual([
      expect.objectContaining({ guard: "ai-image-input", action: "redact" }),
      expect.objectContaining({
        guard: "ai-image-output",
        action: "warn",
        mode: "report",
      }),
    ]);
  });

  it("accepts routing wrappers and sends only the selected leaf model", async () => {
    const file = {
      base64: "AQI=",
      uint8Array: new Uint8Array([1, 2]),
      mediaType: "image/png",
    };
    const scripted = imageGateway({
      image: file,
      images: [file],
      warnings: [],
      responses: [],
      providerMetadata: {},
      usage: {},
    });
    const first = { provider: "test", modelId: "image-a" } as ImageModel;
    await createCruxAi({ gateway: scripted.gateway }).generateImage({
      model: fallback([first, {} as ImageModel]),
      prompt: "x",
    });
    expect(scripted.image.mock.calls[0]?.[0]).toMatchObject({ model: first });
  });

  it("performs one generateImage operation without entering the language loop", async () => {
    expect(imageGenerationConformanceRow("ai-sdk").support).toBe("native");
    const file = {
      base64: "AQI=",
      uint8Array: new Uint8Array([1, 2]),
      mediaType: "image/png",
    };
    const raw = {
      image: file,
      images: [file],
      warnings: [{ type: "unsupported-setting", setting: "x" }],
      responses: [
        {
          timestamp: new Date(0),
          modelId: "image-model",
          headers: { request: "1" },
        },
      ],
      providerMetadata: { test: { requestId: "req-1" } },
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    };
    const scripted = imageGateway(raw);
    const ai = createCruxAi({ gateway: scripted.gateway });
    const model = {} as ImageModel;

    const result = await ai.generateImage({
      model,
      prompt: "A quiet canal",
      n: 1,
      size: "1024x1024",
      seed: 3,
      extra: {
        maxRetries: 0,
        headers: { "x-test": "yes" },
        providerOptions: { test: { style: "quiet" } },
      },
    });

    expect(scripted.image).toHaveBeenCalledOnce();
    expect(scripted.text).not.toHaveBeenCalled();
    expect(scripted.stream).not.toHaveBeenCalled();
    expect(scripted.image).toHaveBeenCalledWith({
      model,
      prompt: "A quiet canal",
      n: 1,
      size: "1024x1024",
      seed: 3,
      maxRetries: 0,
      headers: { "x-test": "yes" },
      providerOptions: { test: { style: "quiet" } },
      abortSignal: expect.any(AbortSignal),
    });
    expect(result.raw).toBe(raw);
    expect(result.image).toBe(result.images[0]);
    expect(result.providerMetadata).toBe(raw.providerMetadata);
    expect(result).not.toHaveProperty("response");
    expect(result.warnings).toEqual(raw.warnings);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expect(result.image).toMatchObject({
      type: "data",
      data: new Uint8Array([1, 2]),
    });
    expectTypeOf(generateImage).toBeFunction();
    expectTypeOf(ai.generateImage).toBeFunction();
  });

  it("maps byte edit inputs and preserves gateway failures unchanged", async () => {
    const providerError = new Error("provider failed");
    const scripted = imageGateway(undefined);
    scripted.image.mockRejectedValueOnce(providerError);
    const image = {
      type: "data" as const,
      data: new Uint8Array([1]),
      mediaType: "image/png",
    };

    await expect(
      createCruxAi({ gateway: scripted.gateway }).generateImage({
        model: {} as ImageModel,
        prompt: { text: "Edit", images: [image], mask: image },
      }),
    ).rejects.toBe(providerError);

    expect(scripted.image.mock.calls[0]?.[0]).toMatchObject({
      prompt: {
        text: "Edit",
        images: [new Uint8Array([1])],
        mask: new Uint8Array([1]),
      },
    });
  });
});
