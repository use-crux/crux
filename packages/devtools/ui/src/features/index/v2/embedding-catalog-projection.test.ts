import { describe, expect, it } from "vitest";
import { projectEmbeddingConsumerCatalog } from "./embedding-catalog";
import {
  matchesMediaCatalogFilter,
  mediaCatalogBadges,
} from "./media-catalog";

function projectConsumer() {
  return projectEmbeddingConsumerCatalog({
    id: "rag.retriever:search",
    name: "search",
    kind: "rag.retriever",
    dependencies: [
      {
        relationType: "rag.retriever.uses_dense_embedding",
        id: "embedding:vision",
        name: "vision",
        facts: {
          kind: "embedding",
          identityInputs: { modalities: ["text", "image", "audio"] },
          input: "data:image/png;base64,PRIVATE_BYTES",
          signedUrl: "https://assets.example/dog?signature=PRIVATE_SIGNATURE",
          providerFileId: "provider-file-private",
          filename: "private-dog.png",
          hydratedAsset: { bytes: "PRIVATE_HYDRATED_CONTENT" },
        },
      },
    ],
  })!;
}

describe("embedding Catalog projection", () => {
  it("uses the media Catalog modality filters for embedding consumers", () => {
    const view = projectConsumer();

    expect(matchesMediaCatalogFilter(view, "embeddings")).toBe(true);
    expect(matchesMediaCatalogFilter(view, "images")).toBe(true);
    expect(matchesMediaCatalogFilter(view, "audio")).toBe(true);
    expect(matchesMediaCatalogFilter(view, "documents")).toBe(false);
    expect(mediaCatalogBadges(view)).toEqual([
      "embedding consumer",
      "text",
      "image",
      "audio",
    ]);
  });

  it("rebuilds a closed byte-safe view from arbitrary definition facts", () => {
    const serialized = JSON.stringify(projectConsumer());

    expect(serialized).not.toContain("PRIVATE_BYTES");
    expect(serialized).not.toContain("PRIVATE_SIGNATURE");
    expect(serialized).not.toContain("provider-file-private");
    expect(serialized).not.toContain("private-dog.png");
    expect(serialized).not.toContain("PRIVATE_HYDRATED_CONTENT");
  });
});
