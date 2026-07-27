import { describe, expect, it } from "vitest";
import { parseEvalCatalog } from "./parse-catalog";

const catalogEntry = {
  id: "support",
  definitionFingerprint: "definition-v1",
  sourceKey: { relativeFile: "evals/support.eval.ts" },
  cases: [{ id: "refund" }],
  variants: ["current"],
};

describe("parseEvalCatalog", () => {
  it("accepts legacy omission and preserves canonical timeout projections", () => {
    expect(parseEvalCatalog([catalogEntry])).toEqual([catalogEntry]);

    const configured = {
      ...catalogEntry,
      timeout: {
        authored: { totalMs: 30_000, tools: { archive: null, search: 1_500 } },
        effective: {
          totalMs: 30_000,
          tools: { archive: null, search: 1_500 },
        },
      },
      cases: [
        {
          id: "refund",
          timeout: {
            effective: {
              totalMs: 30_000,
              tools: { archive: null, search: 1_500 },
            },
          },
        },
      ],
    };

    expect(parseEvalCatalog([configured])).toEqual([configured]);
  });

  it.each([
    ["non-object projection", "timeout", null],
    ["unknown policy key", "timeout.effective", { total: 30_000 }],
    ["non-canonical number", "timeout.effective", { totalMs: 1.5 }],
    ["disabled numeric sentinel", "timeout.effective", { totalMs: 0 }],
    [
      "unsorted Tool keys",
      "timeout.effective",
      { tools: { search: 1_500, archive: null } },
    ],
    ["unsafe Tool data", "timeout.effective", { tools: [] }],
  ])("rejects %s", (_label, path, malformed) => {
    const target =
      path === "timeout"
        ? { ...catalogEntry, timeout: malformed }
        : {
            ...catalogEntry,
            timeout: {
              effective: malformed,
            },
          };

    expect(() => parseEvalCatalog([target])).toThrow(/malformed Eval catalog/);
  });
});
