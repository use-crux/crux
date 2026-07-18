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
});
