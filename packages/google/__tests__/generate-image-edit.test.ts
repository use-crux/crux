import {
  EditMode,
  MaskReferenceImage,
  RawReferenceImage,
  type GoogleGenAI,
} from "@google/genai";
import { describe, expect, it, vi } from "vitest";
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

describe("Google image editing", () => {
  it("edits Imagen references and a mask through one native edit call", async () => {
    const raw = {
      generatedImages: [
        { image: { imageBytes: "AQI=", mimeType: "image/png" } },
      ],
    };
    const { client, editImage, generateContent, generateImages } =
      clientWith(raw);

    const result = await createGoogle(client, {
      cachedContent: false,
    }).generateImage({
      model: "imagen-3.0-capability-001",
      prompt: {
        text: "Replace the boat with a canoe",
        images: [
          { type: "data", data: new Uint8Array([1]), mediaType: "image/png" },
          {
            type: "data",
            data: new Uint8Array([2]),
            mediaType: "image/webp",
          },
        ],
        mask: {
          type: "data",
          data: new Uint8Array([3]),
          mediaType: "image/png",
        },
      },
      n: 2,
      aspectRatio: "16:9",
      seed: 7,
      extra: {
        edit: {
          editMode: EditMode.EDIT_MODE_INPAINT_INSERTION,
          negativePrompt: "motorboat",
        },
      },
    });

    expect(generateImages).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
    expect(editImage).toHaveBeenCalledOnce();
    const request = editImage.mock.calls[0]?.[0] as {
      model: string;
      prompt: string;
      referenceImages: Array<RawReferenceImage | MaskReferenceImage>;
      config: Record<string, unknown>;
    };
    expect(request).toMatchObject({
      model: "imagen-3.0-capability-001",
      prompt: "Replace the boat with a canoe",
      config: {
        abortSignal: expect.any(AbortSignal),
        numberOfImages: 2,
        aspectRatio: "16:9",
        seed: 7,
        editMode: "EDIT_MODE_INPAINT_INSERTION",
        negativePrompt: "motorboat",
      },
    });
    expect(request.referenceImages).toHaveLength(3);
    expect(request.referenceImages[0]).toBeInstanceOf(RawReferenceImage);
    expect(request.referenceImages[1]).toBeInstanceOf(RawReferenceImage);
    expect(request.referenceImages[2]).toBeInstanceOf(MaskReferenceImage);
    expect(
      request.referenceImages.map((reference) => reference.referenceId),
    ).toEqual([1, 2, 3]);
    expect(
      request.referenceImages.map((reference) => reference.referenceImage),
    ).toEqual([
      { imageBytes: "AQ==", mimeType: "image/png" },
      { imageBytes: "Ag==", mimeType: "image/webp" },
      { imageBytes: "Aw==", mimeType: "image/png" },
    ]);
    expect(
      (request.referenceImages[2] as MaskReferenceImage).toReferenceImageAPI(),
    ).toMatchObject({
      referenceType: "REFERENCE_TYPE_MASK",
      referenceId: 3,
      maskImageConfig: { maskMode: "MASK_MODE_USER_PROVIDED" },
    });
    expect(result.raw).toBe(raw);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
  });

  it("rejects Gemini masks before any provider call", async () => {
    const { client, editImage, generateContent, generateImages } = clientWith({
      candidates: [],
    });

    await expect(
      createGoogle(client, { cachedContent: false }).generateImage({
        model: "gemini-2.5-flash-image",
        prompt: {
          text: "Replace the boat",
          images: [
            {
              type: "data",
              data: new Uint8Array([1]),
              mediaType: "image/png",
            },
          ],
          mask: {
            type: "data",
            data: new Uint8Array([2]),
            mediaType: "image/png",
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      capability: "image.edit.mask",
      path: "prompt.mask",
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateImages).not.toHaveBeenCalled();
    expect(editImage).not.toHaveBeenCalled();
  });

  it("rejects non-data Imagen references with an exact safe path", async () => {
    const { client, editImage, generateContent, generateImages } = clientWith({
      generatedImages: [],
    });

    await expect(
      createGoogle(client, { cachedContent: false }).generateImage({
        model: "imagen-3.0-capability-001",
        prompt: {
          text: "Replace the boat",
          images: [
            {
              type: "url",
              url: new URL("https://media.example/reference.png"),
              mediaType: "image/png",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      capability: "image.edit.reference",
      path: "prompt.images[0]",
    });
    expect(generateContent).not.toHaveBeenCalled();
    expect(generateImages).not.toHaveBeenCalled();
    expect(editImage).not.toHaveBeenCalled();
  });
});
