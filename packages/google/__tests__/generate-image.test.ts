import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { imageGenerationConformanceRow } from "@use-crux/core/adapter/testing";
import { fallback } from "@use-crux/core";
import { createGoogle } from "../src";

function clientWith(response: unknown) {
  const generateImages = vi.fn(async (_args: unknown) => response);
  const generateContent = vi.fn(async (_args: unknown) => response);
  const editImage = vi.fn(async (_args: unknown) => response);
  return {
    client: {
      models: { generateImages, generateContent, editImage },
    } as unknown as GoogleGenAI,
    generateImages,
    generateContent,
    editImage,
  };
}

describe("Google image generation", () => {
  it("accepts routing wrappers and sends only the selected leaf model", async () => {
    const { client, generateImages } = clientWith({
      generatedImages: [
        { image: { imageBytes: "AQI=", mimeType: "image/png" } },
      ],
    });
    await createGoogle(client, { cachedContent: false }).generateImage({
      model: fallback(["imagen-4.0-generate-001", "custom-image-model"]),
      prompt: "x",
    });
    expect(generateImages.mock.calls[0]?.[0]).toMatchObject({
      model: "imagen-4.0-generate-001",
    });
  });

  it("routes Gemini image generation and reference editing through one native content call", async () => {
    const { client, generateImages, generateContent } = clientWith({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AQI=", mimeType: "image/png" } }],
          },
        },
      ],
    });
    const result = await createGoogle(client, {
      cachedContent: false,
    }).generateImage({
      model: "gemini-2.5-flash-image",
      prompt: {
        text: "Remove the boat",
        images: [
          { type: "data", data: new Uint8Array([3]), mediaType: "image/png" },
        ],
      },
      aspectRatio: "16:9",
      seed: 4,
    });

    expect(generateImages).not.toHaveBeenCalled();
    expect(generateContent).toHaveBeenCalledOnce();
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-2.5-flash-image",
      contents: [
        {
          role: "user",
          parts: [
            { text: "Remove the boat" },
            { inlineData: { data: "Aw==", mimeType: "image/png" } },
          ],
        },
      ],
      config: {
        responseModalities: ["IMAGE"],
        seed: 4,
        imageConfig: { aspectRatio: "16:9" },
      },
    });
    expect(result.raw).toBe(
      generateContent.mock.results[0]?.value
        ? await generateContent.mock.results[0].value
        : undefined,
    );
    expect(result.image.mediaType).toBe("image/png");
  });

  it("uses one native generateImages call and preserves ordered image bytes", async () => {
    expect(imageGenerationConformanceRow("google").support).toBe("native");
    const raw = {
      generatedImages: [
        {
          image: { imageBytes: "AQI=", mimeType: "image/png" },
          enhancedPrompt: "Enhanced",
        },
        { image: { imageBytes: "AwQ=", mimeType: "image/webp" } },
      ],
      sdkHttpResponse: {
        headers: { "x-request-id": "req-1", authorization: "secret" },
        responseInternal: { status: 200 },
      },
    };
    const { client, generateImages } = clientWith(raw);
    const google = createGoogle(client, { cachedContent: false });

    const result = await google.generateImage({
      model: "imagen-4.0-generate-001",
      prompt: "A quiet canal",
      n: 2,
      aspectRatio: "16:9",
      seed: 7,
      extra: {
        imagen: {
          outputMimeType: "image/webp",
          includeRaiReason: true,
          imageSize: "2K",
        },
      },
    });

    expect(generateImages).toHaveBeenCalledOnce();
    expect(generateImages).toHaveBeenCalledWith({
      model: "imagen-4.0-generate-001",
      prompt: "A quiet canal",
      config: {
        abortSignal: expect.any(AbortSignal),
        numberOfImages: 2,
        aspectRatio: "16:9",
        seed: 7,
        outputMimeType: "image/webp",
        includeRaiReason: true,
        imageSize: "2K",
      },
    });
    expect(result.raw).toBe(raw);
    expect(result.images.map((image) => image.mediaType)).toEqual([
      "image/png",
      "image/webp",
    ]);
    expect(result.providerMetadata).toEqual({
      requestId: "req-1",
      status: 200,
    });
    expect(result.warnings).toEqual([]);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expect(result).not.toHaveProperty("usage");
    expectTypeOf(google.generateImage).toBeFunction();
  });

  it("keeps endpoint extras isolated and lets unknown Gemini ids reach native validation", async () => {
    const { client, generateContent, generateImages } = clientWith({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { data: "AQI=", mimeType: "image/png" } }],
          },
        },
      ],
    });
    const google = createGoogle(client, { cachedContent: false });

    await google.generateImage({
      model: "gemini-future-image-model",
      prompt: "x",
      extra: { gemini: { temperature: 0.2 } },
    });
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      config: { temperature: 0.2, responseModalities: ["IMAGE"] },
    });
    expect(generateContent.mock.calls[0]?.[0]).not.toMatchObject({
      config: { outputMimeType: expect.anything() },
    });
    expect(generateImages).not.toHaveBeenCalled();

    await expect(
      google.generateImage({
        model: "gemini-future-image-model",
        prompt: "x",
        extra: { imagen: { outputMimeType: "image/webp" } },
      } as never),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(generateContent).toHaveBeenCalledOnce();
  });

  it("rejects known unsupported models before client I/O", async () => {
    const { client, editImage, generateContent, generateImages } = clientWith({
      generatedImages: [],
    });
    const google = createGoogle(client, { cachedContent: false });

    await expect(
      google.generateImage({ model: "gemini-2.5-flash", prompt: "x" }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
    });
    expect(generateImages).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(editImage).not.toHaveBeenCalled();
  });

  it("turns filtered/text-only successes into no-image errors and preserves native failures", async () => {
    const blocked = clientWith({
      generatedImages: [{ raiFilteredReason: "safety policy" }],
    });
    await expect(
      createGoogle(blocked.client, { cachedContent: false }).generateImage({
        model: "imagen-4.0-generate-001",
        prompt: "x",
      }),
    ).rejects.toMatchObject({ code: "no_image_generated" });

    const providerError = new Error("native failure");
    const failing = clientWith(undefined);
    failing.generateImages.mockRejectedValueOnce(providerError);
    await expect(
      createGoogle(failing.client, { cachedContent: false }).generateImage({
        model: "custom-image-model",
        prompt: "x",
      }),
    ).rejects.toBe(providerError);
  });
});
