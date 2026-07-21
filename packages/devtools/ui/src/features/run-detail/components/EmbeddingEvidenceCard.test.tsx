import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ObservabilityRunDetailNode } from "@/types";
import { EmbeddingEvidenceCard } from "./EmbeddingEvidenceCard";

const DIGEST = "0123456789abcdef".repeat(4);

function embeddingNode(
  attributes: Record<string, unknown>,
  report?: Record<string, unknown>,
): ObservabilityRunDetailNode {
  return {
    primitive: "embedding.call",
    attributes,
    artifacts: report
      ? [{ kind: "embedding.report", preview: report }]
      : [],
    details: [],
  } as unknown as ObservabilityRunDetailNode;
}

describe("EmbeddingEvidenceCard", () => {
  it("renders role, modality counts, and a shortened copyable space digest", () => {
    const html = renderToStaticMarkup(
      <EmbeddingEvidenceCard
        node={embeddingNode({
          role: "query",
          modalityCounts: { text: 2, image: 1, audio: 3 },
          embeddingSpace: DIGEST,
          model: "gemini-embedding-2",
          dimensions: 3_072,
        })}
      />,
    );

    expect(html).toContain("query");
    expect(html).toContain("text × 2");
    expect(html).toContain("image × 1");
    expect(html).toContain("audio × 3");
    expect(html).toContain("0123456789ab…");
    expect(html).toContain('aria-label="Copy full embedding space digest"');
    expect(html).not.toContain(DIGEST);
  });

  it("projects report fallbacks through a closed byte-safe view", () => {
    const html = renderToStaticMarkup(
      <EmbeddingEvidenceCard
        node={embeddingNode(
          {},
          {
            role: "document",
            modalityCounts: { video: 1 },
            embeddingSpace: DIGEST,
            model: "multimodal-model",
            bytes: "SECRET_BYTES",
            dataUrl: "data:video/mp4;base64,SECRET_DATA",
            signedUrl: "https://example.test/file?signature=SECRET_SIGNATURE",
            providerFileId: "SECRET_FILE_ID",
            filename: "private-video.mp4",
          },
        )}
      />,
    );

    expect(html).toContain("document");
    expect(html).toContain("video × 1");
    expect(html).toContain("multimodal-model");
    expect(html).not.toMatch(/SECRET_|data:video|private-video/u);
    expect(html).not.toMatch(/<(?:audio|img|video)\b/u);
  });

  it("preserves the generic metrics fallback for older spans", () => {
    const html = renderToStaticMarkup(
      <EmbeddingEvidenceCard
        node={embeddingNode({ model: "legacy-model", dimensions: 768 })}
      />,
    );

    expect(html).toContain("Run");
    expect(html).toContain("legacy-model");
    expect(html).toContain("768");
  });
});
