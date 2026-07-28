import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { IndexLintFinding, ProjectIndexData } from "@/types";
import { buildIndex } from "./adapt";
import { IndexIndexProvider } from "./context";
import {
  FindingDetail,
  IndexHealthList,
  IndexHealthSection,
  filterIndexHealthFindings,
  indexHealthFilterCounts,
} from "./health";
import { indexHealthSubtitle } from "@/features/index/components/IndexHealth";

function suppressedIndex(reason: string | null = "intentional handoff") {
  return buildIndex({
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
        title: "Suppressed example",
        message: "Example finding",
        rationale: "Example rationale",
        source: { file: "src/workflow.ts", line: 8, column: 2 },
        relatedDefinitionIds: [],
        evidence: [],
        fixes: [],
        docsUrl: "https://use-crux.dev/lint/example.rule",
        suppressed: true,
        suppressedBy: {
          source: { file: "src/workflow.ts", line: 7, column: 4 },
          scope: "next-line",
          ...(reason ? { reason } : {}),
        },
      },
    ],
  } satisfies ProjectIndexData);
}

function finding(
  id: string,
  primaryDefinitionId: string,
  suppressed: boolean,
  reach: Partial<
    Pick<
      IndexLintFinding,
      | "relatedDefinitionIds"
      | "affectedDefinitionIds"
      | "propagatedDefinitionIds"
    >
  > = {},
): IndexLintFinding {
  const base = {
    id,
    severity: suppressed ? ("error" as const) : ("warning" as const),
    ruleId: `${id}.rule`,
    category: "quality" as const,
    maturity: "stable" as const,
    confidence: "high" as const,
    profiles: ["recommended" as const],
    title: id,
    message: `${id} message`,
    rationale: `${id} rationale`,
    primaryDefinitionId,
    relatedDefinitionIds: [],
    evidence: [],
    fixes: [],
    docsUrl: `https://use-crux.dev/lint/${id}.rule`,
    ...reach,
  };
  return suppressed
    ? {
        ...base,
        suppressed: true,
        suppressedBy: {
          source: { file: "src/suppressed.ts", line: 2, column: 3 },
          scope: "file",
        },
      }
    : base;
}

function mixedDefinitionIndex() {
  return buildIndex({
    prompts: [],
    contexts: [],
    tools: [],
    definitions: [
      {
        id: "prompt:writer",
        kind: "prompt",
        name: "writer",
        fidelity: "resolved",
      },
      { id: "tool:helper", kind: "tool", name: "helper", fidelity: "resolved" },
      {
        id: "tool:suppressed-only",
        kind: "tool",
        name: "suppressed-only",
        fidelity: "resolved",
      },
    ],
    relations: [],
    diagnostics: [],
    sources: [],
    lintFindings: [
      finding("active-direct", "prompt:writer", false),
      finding("suppressed-direct", "prompt:writer", true),
      finding("active-related", "tool:helper", false, {
        relatedDefinitionIds: ["prompt:writer"],
      }),
      finding("suppressed-affected", "tool:suppressed-only", true, {
        affectedDefinitionIds: ["prompt:writer"],
      }),
    ],
  } satisfies ProjectIndexData);
}

describe("suppressed lint presentation", () => {
  it("reports suppressed-only health without claiming there are no findings", () => {
    const markup = renderToStaticMarkup(
      <IndexIndexProvider index={suppressedIndex()}>
        <IndexHealthList />
      </IndexIndexProvider>,
    );

    expect(markup).toContain("0 active findings");
    expect(markup).toContain("1 suppressed");
    expect(markup).not.toContain("No findings");
  });

  it("keeps the Index Health shell subtitle truthful for suppressed-only state", () => {
    const subtitle = indexHealthSubtitle(
      suppressedIndex(),
      "2026-07-22T12:00:00.000Z",
    );

    expect(subtitle).toContain("0 active findings");
    expect(subtitle).toContain("1 suppressed");
    expect(subtitle).not.toContain("No findings");
  });

  it("explicitly tags a reasonless suppressed row and records the missing reason", () => {
    const index = suppressedIndex(null);
    const list = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHealthList />
      </IndexIndexProvider>,
    );
    const detail = renderToStaticMarkup(
      <FindingDetail fnd={index.healthFindings[0]} />,
    );

    expect(list).toContain(">suppressed<");
    expect(detail).toContain("no reason recorded");
  });

  it("separates per-definition active and suppressed direct/transitive counts", () => {
    const index = mixedDefinitionIndex();
    const markup = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHealthSection def={index.byId("prompt:writer")!} />
      </IndexIndexProvider>,
    );

    expect(markup).toContain("1 active direct");
    expect(markup).toContain("1 active via deps");
    expect(markup).toContain("1 suppressed direct");
    expect(markup).toContain("1 suppressed via deps");
    expect(markup).toContain("2 active findings across 2 rules");
    expect(markup).toContain("2 suppressed");
    expect(markup).toContain("suppressed-direct");
    expect(markup).toContain("suppressed-affected");
  });

  it("keeps mixed severity, rule, badge, and affected-definition projections active-only", () => {
    const index = mixedDefinitionIndex();
    const markup = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHealthList />
      </IndexIndexProvider>,
    );

    expect(index.lintCount).toBe(2);
    expect(index.ruleDescriptors).toHaveLength(2);
    expect(index.lintsForDef("prompt:writer")).toHaveLength(2);
    expect(markup).toContain("2 active findings");
    expect(markup).toContain("2 suppressed");
    expect(markup).toContain("2 rules firing");
    expect(markup.match(/tool:suppressed-only/g)).toHaveLength(1);
  });

  it("uses the same population for every Index Health filter label and result", () => {
    const findings = mixedDefinitionIndex().healthFindings;
    const counts = indexHealthFilterCounts(findings);

    expect(counts).toEqual({
      all: 4,
      error: 0,
      warning: 2,
      info: 0,
      suppressed: 2,
    });
    expect(filterIndexHealthFindings(findings, "all")).toHaveLength(counts.all);
    expect(filterIndexHealthFindings(findings, "warning")).toHaveLength(
      counts.warning,
    );
    expect(filterIndexHealthFindings(findings, "info")).toHaveLength(
      counts.info,
    );
    expect(filterIndexHealthFindings(findings, "suppressed")).toHaveLength(
      counts.suppressed,
    );
    expect(
      filterIndexHealthFindings(findings, "suppressed").every(
        (finding) => finding.suppressed,
      ),
    ).toBe(true);
  });

  it("renders a dedicated suppressed filter with its retained-row count", () => {
    const markup = renderToStaticMarkup(
      <IndexIndexProvider index={suppressedIndex(null)}>
        <IndexHealthList />
      </IndexIndexProvider>,
    );

    expect(markup).toContain("suppressed");
    expect(markup).toMatch(/suppressed[\s\S]*1/);
  });

  it("strikes retained rows and exposes the authored reason in details", () => {
    const index = suppressedIndex();
    const list = renderToStaticMarkup(
      <IndexIndexProvider index={index}>
        <IndexHealthList />
      </IndexIndexProvider>,
    );
    const detail = renderToStaticMarkup(
      <FindingDetail fnd={index.healthFindings[0]} />,
    );

    expect(list).toContain("line-through");
    expect(list).toContain("Suppressed example");
    expect(detail).toContain("suppressed · intentional handoff");
    expect(detail).toContain("Finding source");
    expect(detail).toContain("src/workflow.ts:8:2");
    expect(detail).toContain("Suppressed by");
    expect(detail).toContain("next-line");
    expect(detail).toContain("src/workflow.ts:7:4");
  });
});
