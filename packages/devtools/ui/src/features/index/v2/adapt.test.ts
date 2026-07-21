import { describe, expect, it } from "vitest";
import { indexFactChips, type ViewDef } from "./adapt";
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
