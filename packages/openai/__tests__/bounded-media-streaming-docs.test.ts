import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import type { Asset } from "@use-crux/core";
import { inMemoryAssetStore } from "@use-crux/core/storage";
import { createOpenAI } from "../src";

/**
 * Compile the complete OpenAI image-stream example used by the multimodal
 * guide. It is intentionally not invoked by tests because it performs SDK I/O.
 */
async function openAIImageStreamExample(apiKey: string) {
  const openai = createOpenAI(new OpenAI({ apiKey }));
  const previews = new Map<number, Asset>();
  const finalImages = new Map<number, Asset>();
  const imageChunks = new Map<number, Uint8Array[]>();
  const assets = inMemoryAssetStore();
  const controller = new AbortController();

  const result = await openai.streamImage({
    model: "gpt-image-2",
    prompt: "A quiet canal at sunrise",
    abortSignal: controller.signal,
    extra: { partial_images: 2 },
  });

  for await (const event of result.fullStream) {
    switch (event.type) {
      case "start":
      case "finish":
        break;
      case "image-preview":
        previews.set(event.outputIndex, event.image);
        break;
      case "image-delta": {
        const chunks = imageChunks.get(event.outputIndex) ?? [];
        chunks.push(event.data);
        imageChunks.set(event.outputIndex, chunks);
        break;
      }
      case "image":
        finalImages.set(event.outputIndex, event.image);
        break;
    }
  }

  const picture = await result.completion;
  const storedPicture = await assets.put(picture.image);
  return { picture, storedPicture, previews, finalImages, imageChunks };
}

describe("OpenAI bounded-media documentation example", () => {
  it("stays a checked public-API program without making provider calls", () => {
    expect(typeof openAIImageStreamExample).toBe("function");
  });
});
