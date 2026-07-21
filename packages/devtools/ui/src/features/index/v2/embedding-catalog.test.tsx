import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider } from "./context";
import { IndexHealthSection } from "./health";
import { IndexHero } from "./hero";

const DIGEST = "0123456789abcdef".repeat(4);

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "embedding:src-search.ts:vision",
      kind: "embedding",
      name: "vision",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "embedding",
          embeddingKind: "dense",
          identityInputs: {
            modalities: ["text", "image", "audio"],
          },
          identityDigest: DIGEST,
          space: {
            name: "vision-space",
            dimensions: 1_536,
            digest: DIGEST,
          },
          input: "data:image/png;base64,PRIVATE_BYTES",
          signedUrl: "https://assets.example/dog?signature=PRIVATE_SIGNATURE",
          providerFileId: "provider-file-private",
          filename: "private-dog.png",
          hydratedAsset: { bytes: "PRIVATE_HYDRATED_CONTENT" },
        },
      },
    },
    {
      id: "rag.retriever:search",
      kind: "rag.retriever",
      name: "search",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "rag.retriever",
          retrieverId: "search",
          namespace: "media",
          topK: 8,
        },
      },
    },
    {
      id: "embedding:src-search.ts:sparse",
      kind: "embedding",
      name: "keywords",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "embedding",
          embeddingKind: "sparse",
          identityInputs: { modalities: ["text"] },
          identityDigest: "fedcba9876543210".repeat(4),
        },
      },
    },
    {
      id: "rag.knowledgeBase:docs",
      kind: "rag.knowledgeBase",
      name: "docs",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "rag.knowledgeBase",
          knowledgeBaseId: "docs",
          namespace: "media",
        },
      },
    },
  ],
  relations: [
    {
      id: "relation:search:vision",
      type: "rag.retriever.uses_dense_embedding",
      from: "rag.retriever:search",
      to: "embedding:src-search.ts:vision",
      fidelity: "resolved",
    },
    {
      id: "relation:docs:vision",
      type: "rag.knowledgeBase.uses_dense_embedding",
      from: "rag.knowledgeBase:docs",
      to: "embedding:src-search.ts:vision",
      fidelity: "resolved",
    },
    {
      id: "relation:docs:sparse",
      type: "rag.knowledgeBase.uses_sparse_embedding",
      from: "rag.knowledgeBase:docs",
      to: "embedding:src-search.ts:sparse",
      fidelity: "resolved",
    },
  ],
  diagnostics: [],
  lintFindings: [
    {
      id: "lint:embedding:modality",
      severity: "error",
      ruleId: "embedding.unsupported-modality",
      category: "contracts",
      maturity: "experimental",
      confidence: "high",
      profiles: ["recommended", "strict"],
      title: "Embedding does not support this modality",
      message: "Embedding does not declare image input.",
      rationale: "The call would fail before provider I/O.",
      source: { file: "src/search.ts", line: 18, column: 4 },
      primaryDefinitionId: "rag.retriever:search",
      relatedDefinitionIds: ["embedding:src-search.ts:vision"],
      evidence: [
        {
          kind: "source",
          label: "image query",
          description: "The retriever receives image input here.",
          source: { file: "src/search.ts", line: 18, column: 4 },
        },
      ],
      fixes: [
        {
          title: "Use a multimodal embedding",
          description: "Configure an embedding that declares image input.",
          kind: "manual",
        },
      ],
      docsUrl:
        "/docs/reference/crux-core/index-lints/embedding-unsupported-modality",
    },
  ],
  sources: [],
} satisfies ProjectIndexData;

function render(definitionId: string): string {
  const index = buildIndex(data);
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexHero def={index.byId(definitionId)!} />
    </IndexIndexProvider>,
  );
}

function renderHealth(definitionId: string): string {
  const index = buildIndex(data);
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexHealthSection def={index.byId(definitionId)!} />
    </IndexIndexProvider>,
  );
}

describe("embedding Catalog cards", () => {
  it("renders a retriever's modalities and dense embedding space", () => {
    const html = render("rag.retriever:search");

    expect(html).toContain("Embedding space");
    expect(html).toContain("text");
    expect(html).toContain("image");
    expect(html).toContain("audio");
    expect(html).toContain("vision-space");
    expect(html).toContain("1,536 dimensions");
    expect(html).toContain("0123456789ab…");
    expect(html).not.toContain(DIGEST);
    expect(html).not.toContain("PRIVATE_BYTES");
    expect(html).not.toContain("PRIVATE_SIGNATURE");
    expect(html).not.toContain("provider-file-private");
    expect(html).not.toContain("private-dog.png");
    expect(html).not.toContain("PRIVATE_HYDRATED_CONTENT");
  });

  it("renders dense and sparse knowledge-base embeddings distinctly", () => {
    const html = render("rag.knowledgeBase:docs");

    expect(html).toContain("Knowledge base");
    expect(html).toContain("vision");
    expect(html).toContain("keywords");
    expect(html).toContain("dense");
    expect(html).toContain("sparse");
    expect(html.match(/aria-label="Embedding space"/gu)).toHaveLength(1);
    expect(html).not.toContain("fedcba987654…");
  });

  it("renders embedding findings through the standard Health path", () => {
    const html = renderHealth("rag.retriever:search");

    expect(html).toContain("Embedding does not support this modality");
    expect(html).toContain(">error</span>");
    expect(html).toContain("contracts");
    expect(html).toContain("src/search.ts:18");
    expect(html).toContain("Configure an embedding that declares image input.");
  });

  it("preserves the standard Health empty state", () => {
    const html = renderHealth("rag.knowledgeBase:docs");

    expect(html).toContain("Clean");
    expect(html).toContain(
      "No findings — every applicable rule passes on this definition.",
    );
  });
});
