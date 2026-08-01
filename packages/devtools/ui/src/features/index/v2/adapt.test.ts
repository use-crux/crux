import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { buildIndex, indexFactChips, type ViewDef } from "./adapt";
import { indexSectionOrder } from "./detail";
import { kindMeta } from "./kit";

describe("indexFactChips", () => {
  it("renders Eval catalog facts as at-a-glance chips", () => {
    const def = {
      kind: "eval",
      facts: {
        caseCount: 2,
        scorerIds: ["exact", "helpful"],
      },
    } as ViewDef;

    expect(indexFactChips(def)).toEqual([
      ["cases", 2],
      ["scorers", 2],
    ]);
  });

  it("renders Safety boundaries and strategy as at-a-glance chips", () => {
    const def = {
      id: "guardrail:media",
      kind: "guardrail",
      name: "media",
      fidelity: "resolved",
      confidence: "static",
      facts: {
        boundaries: ["model.input.media", "model.output.media"],
        strategy: { kind: "media", config: { action: "strip" } },
      },
      lint: [],
      raw: {
        id: "guardrail:media",
        kind: "guardrail",
        name: "media",
        fidelity: "resolved",
      },
    } satisfies ViewDef;

    expect(indexFactChips(def)).toEqual([
      ["boundaries", 2],
      ["strategy", "media"],
      ["action", "strip"],
    ]);
  });
});

describe("kindMeta", () => {
  it("registers Connected Knowledge definitions in the Capabilities family", () => {
    expect(kindMeta("rag.knowledgeBase.view")).toMatchObject({
      label: "Knowledge view",
      family: "capability",
      glyph: "search",
      child: true,
    });
    expect(kindMeta("knowledge.relation")).toMatchObject({
      label: "Knowledge relation",
      family: "capability",
      glyph: "branch",
    });
    expect(kindMeta("knowledge.assertions")).toMatchObject({
      label: "Knowledge assertions",
      family: "capability",
      glyph: "doc",
    });
    expect(kindMeta("knowledge.communities")).toMatchObject({
      label: "Knowledge communities",
      family: "capability",
      glyph: "grid",
    });
    expect(kindMeta("knowledge.model")).toMatchObject({
      label: "Knowledge model",
      family: "capability",
      glyph: "spark",
    });
  });

  it("registers Thread definitions in the State family", () => {
    expect(kindMeta("thread")).toMatchObject({
      label: "Thread",
      family: "state",
      glyph: "branch",
    });
  });

  it("registers Eval definitions in the Evals family", () => {
    expect(kindMeta("eval")).toMatchObject({
      label: "Eval",
      family: "evals",
    });
    expect(kindMeta("eval.case")).toMatchObject({
      label: "Case",
      family: "evals",
      child: true,
    });
  });

  it("registers deferred-work definitions under orchestration", () => {
    expect(kindMeta("deferred-work")).toMatchObject({
      label: "Deferred work",
      family: "orchestration",
    });
  });

  it("registers media.operation and ingest.source in the media family", () => {
    expect(kindMeta("media.operation")).toMatchObject({
      label: "Media operation",
      family: "media",
    });
    expect(kindMeta("ingest.source")).toMatchObject({
      label: "Ingest source",
      family: "media",
    });
  });

  it("registers embedding and vector-indexer Project Index definitions", () => {
    expect(kindMeta("embedding")).toMatchObject({
      label: "Embedding",
      family: "media",
    });
    expect(kindMeta("embedding.call")).toMatchObject({
      label: "Embedding call",
      family: "media",
      child: true,
    });
    expect(kindMeta("rag.indexer")).toMatchObject({
      label: "Indexer",
      family: "capability",
    });
  });
});

describe("Thread catalog presentation", () => {
  it("keeps Thread relationships prominent without inventing live facts", () => {
    const def = {
      id: "thread:conversation",
      kind: "thread",
      name: "conversation",
      fidelity: "resolved",
      confidence: "static",
      facts: { kind: "thread" },
      lint: [],
      raw: {
        id: "thread:conversation",
        kind: "thread",
        name: "conversation",
        fidelity: "resolved",
      },
    } satisfies ViewDef;

    expect(indexFactChips(def)).toEqual([]);
    expect(indexSectionOrder(def)).toEqual([
      "hero",
      "threadInspector",
      "relations",
      "source",
      "observability",
      "health",
    ]);
  });
});

describe("Connected Knowledge catalog presentation", () => {
  it("renders knowledge facts as at-a-glance chips", () => {
    expect(
      indexFactChips({
        id: "rag.knowledgeBase:docs:view:published",
        kind: "rag.knowledgeBase.view",
        name: "published",
        fidelity: "resolved",
        confidence: "static",
        facts: {
          viewId: "published",
          whereFields: ["audience", "status"],
        },
        lint: [],
        raw: {
          id: "rag.knowledgeBase:docs:view:published",
          kind: "rag.knowledgeBase.view",
          name: "published",
          fidelity: "resolved",
        },
      } satisfies ViewDef),
    ).toEqual([
      ["view", "published"],
      ["where", 2],
    ]);

    expect(
      indexFactChips({
        id: "knowledge.relation:citations",
        kind: "knowledge.relation",
        name: "citations",
        fidelity: "resolved",
        confidence: "static",
        facts: {
          relationId: "citations",
          version: 3,
          typeNames: ["cites"],
          modelName: "extractor",
        },
        lint: [],
        raw: {
          id: "knowledge.relation:citations",
          kind: "knowledge.relation",
          name: "citations",
          fidelity: "resolved",
        },
      } satisfies ViewDef),
    ).toEqual([
      ["id", "citations"],
      ["version", 3],
      ["types", 1],
      ["model", "extractor"],
    ]);
  });

  it("rolls knowledge views under their owning knowledge base", () => {
    const index = buildIndex({
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
            facts: { kind: "rag.knowledgeBase", knowledgeBaseId: "docs" },
          },
        },
        {
          id: "rag.knowledgeBase:docs:view:published",
          kind: "rag.knowledgeBase.view",
          name: "published",
          fidelity: "resolved",
          metadata: {
            indexPresentation: {
              standalone: false,
              role: "view",
              parentDefinitionId: "rag.knowledgeBase:docs",
              parentRelationType: "rag.knowledgeBase.includes_view",
            },
            facts: {
              kind: "rag.knowledgeBase.view",
              knowledgeBaseId: "rag.knowledgeBase:docs",
              viewId: "published",
              whereFields: ["status"],
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
      ],
      diagnostics: [],
      lintFindings: [],
      sources: [],
    } satisfies ProjectIndexData);

    expect(index.standalone.map((def) => def.id)).toEqual([
      "rag.knowledgeBase:docs",
    ]);
    expect(index.parentOf("rag.knowledgeBase:docs:view:published")).toBe(
      "rag.knowledgeBase:docs",
    );
    expect(
      index.childrenOf("rag.knowledgeBase:docs").map((def) => def.id),
    ).toEqual(["rag.knowledgeBase:docs:view:published"]);
    expect(
      indexSectionOrder({
        id: "knowledge.relation:citations",
        kind: "knowledge.relation",
        name: "citations",
        fidelity: "resolved",
        confidence: "static",
        lint: [],
        raw: {
          id: "knowledge.relation:citations",
          kind: "knowledge.relation",
          name: "citations",
          fidelity: "resolved",
        },
      } satisfies ViewDef),
    ).toEqual([
      "hero",
      "knowledge",
      "deps",
      "source",
      "relations",
      "observability",
      "health",
    ]);
  });
});

describe("lint suppression projection", () => {
  it("retains typed directive evidence in the all-findings health view", () => {
    const index = buildIndex({
      prompts: [],
      contexts: [],
      tools: [],
      definitions: [],
      relations: [],
      diagnostics: [],
      sources: [],
      lintFindings: [
        {
          id: "lint:example",
          severity: "warning",
          ruleId: "example.rule",
          category: "quality",
          maturity: "stable",
          confidence: "high",
          profiles: ["recommended"],
          title: "Example rule",
          message: "Example finding",
          rationale: "Example rationale",
          relatedDefinitionIds: [],
          evidence: [],
          fixes: [],
          docsUrl: "https://use-crux.dev/lint/example.rule",
          suppressed: true,
          suppressedBy: {
            source: { file: "src/workflow.ts", line: 7, column: 3 },
            scope: "next-line",
            reason: "intentional handoff",
          },
        },
      ],
    } satisfies ProjectIndexData);

    expect(index.lintCount).toBe(0);
    expect(index.healthFindings).toHaveLength(1);
    expect(index.healthFindings[0].suppressedBy).toEqual({
      source: { file: "src/workflow.ts", line: 7, column: 3 },
      scope: "next-line",
      reason: "intentional handoff",
    });
  });
});
