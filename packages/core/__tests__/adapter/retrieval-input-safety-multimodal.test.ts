/** Multimodal retrieval regressions at the generative model-ingress boundary. */

import { describe, expect, it, vi } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { CallArgs } from "../../src/adapter/types";
import { embedding } from "../../src/embedding";
import { prompt } from "../../src/prompt/prompt";
import { knowledgeBase } from "../../src/retrieval";
import { boundary, guardrail } from "../../src/safety";
import { inMemoryStorage } from "../../src/storage";
import { capturingRetrievalAdapter } from "./retrieval-input-safety.fixture";
import { schema2MediaDocument } from "../fixtures/schema2-stored-evidence";

describe("multimodal direct retrieval input safety", () => {
  it("keeps empty-caption attribution text-only without hydrating assets", async () => {
    const calls: CallArgs[] = [];
    const backingStorage = inMemoryStorage();
    const getAsset = vi.fn(
      (ref: Parameters<NonNullable<typeof backingStorage.assets>["get"]>[0]) =>
        backingStorage.assets!.get(ref),
    );
    const storage = {
      ...backingStorage,
      assets: { ...backingStorage.assets!, get: getAsset },
    };
    const dense = embedding({
      kind: "dense",
      name: "retrieval-safety-media",
      dimensions: 2,
      maxInputTokens: 100,
      modalities: ["text", "image"],
      batch: { maxSize: 8 },
      embed: async (inputs) => inputs.map(() => [1, 0]),
    });
    const docs = knowledgeBase({
      id: "media-docs",
      storage,
      embeddings: dense,
    });
    const image = {
      type: "data" as const,
      data: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    };
    await docs.index([
      schema2MediaDocument({
        namespace: "media-docs",
        sourceId: "photo",
        source: {
          url: "https://private.example/photo",
          path: "/private/photo.png",
          location: { type: "page", pageNumber: 7 },
        },
        asset: image,
      }),
    ]);
    const search = docs.retriever();
    let mediaRuns = 0;
    let rendered = "";
    const answer = prompt({
      id: "empty-caption-retrieval-safety",
      use: [search.asContext({ query: "photo" })],
      prompt: "Answer.",
    });

    await adapter(capturingRetrievalAdapter(calls))({}).generate(answer, {
      model: "test-model",
      guardrails: [
        guardrail({
          id: "inspect-retrieval-attribution",
          on: boundary.input.text({ from: "retrieval" }),
          run: (text) => {
            rendered = text;
            return { action: "allow" };
          },
        }),
        guardrail({
          id: "no-generative-retrieval-media",
          on: boundary.input.media(),
          run: () => {
            mediaRuns++;
            return { action: "allow" };
          },
        }),
      ],
    });
    await search.retrieve(image);

    expect(rendered).toMatch(
      /^## Retrieved Context \(photo\)\n- \[photo\/.+\] \(score: 1\.00\)$/,
    );
    expect(rendered).not.toContain("memory://asset/");
    const providerRequest = JSON.stringify(calls[0]);
    expect(providerRequest).not.toContain("memory://asset/");
    expect(providerRequest).not.toContain("private.example");
    expect(providerRequest).not.toContain("/private/photo.png");
    expect(providerRequest).not.toContain('"pageNumber":7');
    expect(getAsset).not.toHaveBeenCalled();
    expect(mediaRuns).toBe(0);
  });
});
