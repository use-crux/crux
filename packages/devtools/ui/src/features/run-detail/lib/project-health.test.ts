import { describe, expect, it } from "vitest";
import type {
  CruxCurrentCatalogComparison,
  CruxCurrentProjectHealth,
} from "@use-crux/core/observability";
import { projectCurrentProjectHealth } from "./project-health";

const health = {
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

describe("projectCurrentProjectHealth", () => {
  it("links only supported definitions resolved in the current Catalog", () => {
    const currentCatalog = {
      label: "current-catalog",
      resolution: "definition-unresolved",
      definitions: [
        { definitionId: "prompt:writer", matched: true },
        { definitionId: "tool:lookup", matched: false },
      ],
    } satisfies CruxCurrentCatalogComparison;
    const view = projectCurrentProjectHealth(health, currentCatalog);

    expect(view?.active.map((finding) => finding.id)).toEqual(["lint:active"]);
    expect(view?.suppressed.map((finding) => finding.id)).toEqual([
      "lint:suppressed",
    ]);
    expect(view?.active[0]?.matchedDefinitions[0]?.to).toEqual({
      view: "library-index",
      promptId: "prompt:writer",
    });
    expect(view?.suppressed[0]?.matchedDefinitions[0]?.to).toBeUndefined();
  });

  it("keeps unsupported current Catalog definitions as plain evidence", () => {
    const unsupported = structuredClone(health);
    unsupported.findings[0]!.matchedDefinitions[0]!.kind = "agent";
    const view = projectCurrentProjectHealth(unsupported, {
      label: "current-catalog",
      resolution: "resolved",
      definitions: [{ definitionId: "prompt:writer", matched: true }],
    });

    expect(view?.active[0]?.matchedDefinitions[0]?.to).toBeUndefined();
  });
});
