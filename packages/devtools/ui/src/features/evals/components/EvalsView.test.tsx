import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EvalCatalogEntry } from "../types";
import { EvalCatalogTimeoutPolicies } from "./EvalTimeoutPolicy";

const entry = {
  id: "support",
  definitionFingerprint: "definition-v1",
  sourceKey: { relativeFile: "evals/support.eval.ts" },
  variants: ["current"],
  timeout: {
    authored: {
      totalMs: 30_000,
      firstToken: null,
      tools: { search: 1_500 },
    },
    effective: {
      totalMs: 30_000,
      firstToken: null,
      tools: { search: 1_500 },
    },
  },
  cases: [
    {
      id: "inherited",
      timeout: {
        effective: {
          totalMs: 30_000,
          firstToken: null,
          tools: { search: 1_500 },
        },
      },
    },
    {
      id: "partial",
      timeout: {
        authored: { stepMs: 750 },
        effective: {
          totalMs: 30_000,
          stepMs: 750,
          firstToken: null,
          tools: { search: 1_500 },
        },
      },
    },
    {
      id: "clear",
      timeout: {
        authored: null,
        effective: {
          totalMs: null,
          firstToken: null,
          tools: { search: null },
        },
      },
    },
  ],
} satisfies EvalCatalogEntry;

describe("Evals catalog timeout policy", () => {
  it("renders the Eval default and explains every Case inheritance mode", () => {
    const html = renderToStaticMarkup(
      <EvalCatalogTimeoutPolicies entry={entry} />,
    );

    for (const copy of [
      "Task timeout",
      "Total",
      "30 s",
      "First token",
      "Tool · search",
      "1.5 s",
      "Inherits Eval policy",
      "Overrides Eval policy",
      "Clears Eval policy",
      "Step",
      "750 ms",
      "Disabled",
    ]) {
      expect(html).toContain(copy);
    }
    expect(html).not.toContain('"totalMs"');
    expect(html).not.toContain('"stepMs"');
  });
});
