import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CruxCurrentCatalogComparison,
  CruxCurrentProjectHealth,
} from "@use-crux/core/observability";
import { ProjectHealthCard } from "./ProjectHealthCard";

const mixedHealth = {
  label: "current-project-health",
  indexedAt: "2026-07-22T12:00:00Z",
  activeCount: 1,
  suppressedCount: 1,
  findings: [
    {
      id: "lint:active",
      ruleId: "prompt.missing_context",
      severity: "warning",
      title: "Writer has no context",
      message: "Add authored context.",
      matchedDefinitions: [
        {
          definitionId: "prompt:writer",
          kind: "prompt",
          roles: ["resolved-prompt"],
          matchKinds: ["primary"],
        },
      ],
    },
    {
      id: "lint:suppressed",
      ruleId: "tool.missing_schema",
      severity: "error",
      title: "Tool has no schema",
      message: "Add a schema.",
      source: { file: "src/tools.ts", line: 8, column: 2 },
      suppressed: true,
      suppressedBy: {
        source: { file: "src/tools.ts", line: 7, column: 4 },
        scope: "next-line",
        reason: "validated externally",
      },
      matchedDefinitions: [
        {
          definitionId: "tool:lookup",
          kind: "tool",
          roles: ["invoked-tool"],
          matchKinds: ["affected"],
        },
      ],
    },
  ],
} satisfies CruxCurrentProjectHealth;

const resolvedCatalog = {
  label: "current-catalog",
  resolution: "resolved",
  definitions: [
    { definitionId: "prompt:writer", matched: true },
    { definitionId: "tool:lookup", matched: true },
  ],
} satisfies CruxCurrentCatalogComparison;

describe("ProjectHealthCard", () => {
  it("renders mixed current Index context with suppression evidence and Catalog links", () => {
    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        health={mixedHealth}
        currentCatalog={resolvedCatalog}
        onNavigate={vi.fn()}
      />,
    );

    expect(markup).toContain("Project health");
    expect(markup).toContain("current index");
    expect(markup).toContain("not the code at run time");
    expect(markup).toContain("does not affect this run&#x27;s status");
    expect(markup).toContain("1 active");
    expect(markup).toContain("1 suppressed");
    expect(markup).toContain(">suppressed<");
    expect(markup).toContain("Finding source");
    expect(markup).toContain("src/tools.ts:8:2");
    expect(markup).toContain("Suppressed by");
    expect(markup).toContain("src/tools.ts:7:4");
    expect(markup).toContain("next-line");
    expect(markup).toContain("validated externally");
    expect(markup).toContain("invoked-tool");
    expect(markup).toContain("affected");
    expect(markup).toContain("View tool:lookup in Catalog");
  });

  it("renders unresolved and unsupported matches as plain evidence", () => {
    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        health={mixedHealth}
        currentCatalog={{
          ...resolvedCatalog,
          resolution: "definition-unresolved",
          definitions: resolvedCatalog.definitions.map((definition) => ({
            ...definition,
            matched: false,
          })),
        }}
        onNavigate={vi.fn()}
      />,
    );

    expect(markup).toContain("prompt:writer · primary · resolved-prompt");
    expect(markup).not.toContain("View prompt:writer in Catalog");
    expect(markup).not.toContain("View tool:lookup in Catalog");
  });

  it("distinguishes absent context from a checked Index with no relevant findings", () => {
    expect(
      renderToStaticMarkup(
        <ProjectHealthCard health={undefined} onNavigate={vi.fn()} />,
      ),
    ).toBe("");

    const markup = renderToStaticMarkup(
      <ProjectHealthCard
        health={{
          label: "current-project-health",
          indexedAt: "2026-07-22T12:00:00Z",
          activeCount: 0,
          suppressedCount: 0,
          findings: [],
        }}
        onNavigate={vi.fn()}
      />,
    );
    expect(markup).toContain(
      "No current lint findings reference this run&#x27;s definitions.",
    );
  });

  it("renders reasonless suppression as explicit current directive evidence", () => {
    const reasonless = {
      label: "current-project-health",
      indexedAt: "2026-07-22T12:00:00Z",
      activeCount: 0,
      suppressedCount: 1,
      findings: [
        {
          id: "lint:reasonless",
          ruleId: "prompt.reasonless",
          severity: "warning",
          title: "Reasonless suppression",
          message: "Review the directive.",
          suppressed: true,
          suppressedBy: {
            source: { file: "src/prompt.ts", line: 3, column: 5 },
            scope: "file",
          },
          matchedDefinitions: [
            {
              definitionId: "prompt:writer",
              kind: "prompt",
              roles: ["resolved-prompt"],
              matchKinds: ["primary"],
            },
          ],
        },
      ],
    } satisfies CruxCurrentProjectHealth;

    const markup = renderToStaticMarkup(
      <ProjectHealthCard health={reasonless} onNavigate={vi.fn()} />,
    );
    expect(markup).toContain(">suppressed<");
    expect(markup).toContain("src/prompt.ts:3:5");
    expect(markup).toContain("file");
    expect(markup).toContain("no reason recorded");
  });
});
