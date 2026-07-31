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
