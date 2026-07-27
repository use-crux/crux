import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectIndexData } from "@/types";
import { formatTimeoutMs } from "@/shared/lib/format-timeout-ms";
import { buildIndex } from "./adapt";
import { IndexIndexProvider } from "./context";
import { IndexHero } from "./hero";

const configuredEval = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: "eval:support",
      kind: "eval",
      name: "support",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "eval",
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
        },
      },
    },
    {
      id: "eval:empty",
      kind: "eval",
      name: "empty",
      fidelity: "resolved",
      metadata: {
        facts: {
          kind: "eval",
          timeout: { authored: {}, effective: {} },
        },
      },
    },
  ],
  relations: [],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData;

describe("Eval timeout policy", () => {
  it("formats canonical millisecond budgets for every display boundary", () => {
    expect(
      [750, 1_000, 1_500, 30_000, 60_000, 90_000].map(formatTimeoutMs),
    ).toEqual(["750 ms", "1 s", "1.5 s", "30 s", "1 min", "1 min 30 s"]);
  });

  it("adapts and renders the effective Eval timeout policy", () => {
    const index = buildIndex(configuredEval);
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHero def={index.byId("eval:support")!} />
      </IndexIndexProvider>,
    );

    expect(html).toContain("Task timeout");
    expect(html).toContain("Total");
    expect(html).toContain("30 s");
    expect(html).toContain("First token");
    expect(html).toContain("Disabled");
    expect(html).toContain("Tool · search");
    expect(html).toContain("1.5 s");
    expect(html).toContain("Open support in Evals");
    expect(html).not.toContain('"totalMs"');
  });

  it("renders the empty effective-policy state", () => {
    const index = buildIndex(configuredEval);
    const html = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHero def={index.byId("eval:empty")!} />
      </IndexIndexProvider>,
    );

    expect(html).toContain("Task timeout");
    expect(html).toContain("No Eval timeout policy");
    expect(html).toContain("Open empty in Evals");
  });
});
