import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider, IndexSelectProvider } from "./context";
import { CatRelations } from "./detail";
import { IndexKnowledge } from "./knowledge-section";

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "rag.knowledgeBase:docs",
      kind: "rag.knowledgeBase",
      name: "docs",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "rag.knowledgeBase",
          knowledgeBaseId: "docs",
          namespace: "help",
        },
      },
    },
    {
      id: "rag.knowledgeBase:docs:view:published",
      kind: "rag.knowledgeBase.view",
      name: "published",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "rag.knowledgeBase.view",
          knowledgeBaseId: "rag.knowledgeBase:docs",
          viewId: "published",
          whereFields: ["audience", "status"],
        },
      },
    },
    {
      id: "knowledge.model:extractor",
      kind: "knowledge.model",
      name: "extractor",
      fidelity: "resolved",
      metadata: {
        facts: { kind: "knowledge.model", modelName: "extractor", version: 2 },
      },
    },
    {
      id: "knowledge.relation:citations",
      kind: "knowledge.relation",
      name: "citations",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "knowledge.relation",
          relationId: "citations",
          version: 3,
          typeNames: ["cites"],
          modelName: "extractor",
        },
      },
    },
  ],
  relations: [
    {
      id: "relation:kb-view",
      type: "rag.knowledgeBase.includes_view",
      from: "rag.knowledgeBase:docs",
      to: "rag.knowledgeBase:docs:view:published",
      fidelity: "resolved",
    },
    {
      id: "relation:relation-model",
      type: "knowledge.relation.uses_model",
      from: "knowledge.relation:citations",
      to: "knowledge.model:extractor",
      fidelity: "resolved",
    },
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

function render(definitionId: string, relations = false): string {
  const index = buildIndex(data);
  const def = index.byId(definitionId)!;
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexSelectProvider select={() => undefined}>
        {relations ? <CatRelations def={def} /> : <IndexKnowledge def={def} />}
      </IndexSelectProvider>
    </IndexIndexProvider>,
  );
}

describe("Connected Knowledge detail", () => {
  it("shows extracted static knowledge facts", () => {
    const viewHtml = render("rag.knowledgeBase:docs:view:published");
    expect(viewHtml).toContain("knowledge base");
    expect(viewHtml).toContain("rag.knowledgeBase:docs");
    expect(viewHtml).toContain("published");
    expect(viewHtml).toContain("audience, status");

    const relationHtml = render("knowledge.relation:citations");
    expect(relationHtml).toContain("citations");
    expect(relationHtml).toContain("version");
    expect(relationHtml).toContain("3");
    expect(relationHtml).toContain("cites");
    expect(relationHtml).toContain("extractor");
  });

  it("shows ownership and model relations", () => {
    const kbHtml = render("rag.knowledgeBase:docs", true);
    expect(kbHtml).toContain("rag.knowledgeBase:docs:view:published");
    expect(kbHtml).toContain("rag.knowledgeBase.includes view");

    const modelHtml = render("knowledge.model:extractor", true);
    expect(modelHtml).toContain("knowledge.relation:citations");
    expect(modelHtml).toContain("knowledge.relation.uses model");
    expect(modelHtml).toContain("Used by · incoming");
  });
});
