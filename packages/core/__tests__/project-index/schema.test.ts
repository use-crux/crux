import { describe, expect, it } from "vitest";
import {
  ContractFactsSchema,
  DependencyFactsSchema,
  IndexLintFindingSchema,
  ProjectDefinitionKindSchema,
  ProjectIndexSnapshotSchema,
} from "../../src/project-index";

const finding = {
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
};

describe("Project Index schemas", () => {
  it("accepts definition kinds exposed by the public union", () => {
    expect(ProjectDefinitionKindSchema.parse("injectable")).toBe("injectable");
    expect(ProjectDefinitionKindSchema.parse("mcp.server")).toBe("mcp.server");
    expect(ProjectDefinitionKindSchema.parse("eval")).toBe("eval");
    expect(ProjectDefinitionKindSchema.parse("deferred-work")).toBe(
      "deferred-work",
    );
    expect(ProjectDefinitionKindSchema.parse("eval.case")).toBe("eval.case");
  });

  it("preserves published fact fields during parsing", () => {
    expect(
      ContractFactsSchema.parse({
        expandedInputSchema: { type: "object" },
        inputContributions: [
          {
            field: "draft",
            sourceKind: "context",
            via: "direct",
            conditionality: "always",
          },
        ],
      }),
    ).toMatchObject({
      expandedInputSchema: { type: "object" },
      inputContributions: [
        {
          field: "draft",
          sourceKind: "context",
          via: "direct",
          conditionality: "always",
        },
      ],
    });

    expect(
      DependencyFactsSchema.parse({ injectables: ["injectable:safety"] }),
    ).toEqual({
      injectables: ["injectable:safety"],
    });
  });

  it("accepts canonical and explicit active lint findings", () => {
    expect(IndexLintFindingSchema.safeParse(finding).success).toBe(true);
    expect(
      IndexLintFindingSchema.safeParse({ ...finding, suppressed: false })
        .success,
    ).toBe(true);
  });

  it("rejects inconsistent suppression state", () => {
    const suppressedBy = {
      source: { file: "src/workflow.ts", line: 7 },
      scope: "line",
    };

    expect(
      IndexLintFindingSchema.safeParse({ ...finding, suppressed: true })
        .success,
    ).toBe(false);
    expect(
      IndexLintFindingSchema.safeParse({ ...finding, suppressedBy }).success,
    ).toBe(false);
    expect(
      IndexLintFindingSchema.safeParse({
        ...finding,
        suppressed: false,
        suppressedBy,
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported suppression scopes", () => {
    expect(
      IndexLintFindingSchema.safeParse({
        ...finding,
        suppressed: true,
        suppressedBy: {
          source: { file: "src/workflow.ts", line: 7 },
          scope: "next-lineage",
        },
      }).success,
    ).toBe(false);
  });

  it("round-trips retained suppression evidence through the snapshot schema", () => {
    const suppressed = {
      ...finding,
      suppressed: true,
      suppressedBy: {
        source: { file: "src/workflow.ts", line: 7, column: 3 },
        scope: "next-line",
        reason: "intentional handoff",
      },
    };
    const parsed = ProjectIndexSnapshotSchema.parse({
      schemaVersion: 1,
      prompts: [],
      contexts: [],
      project: { root: "/repo" },
      indexedAt: "2026-07-22T00:00:00.000Z",
      definitions: [],
      relations: [],
      diagnostics: [],
      lintFindings: [suppressed],
      sources: [],
    });

    expect(parsed.lintFindings[0]).toMatchObject({
      suppressed: true,
      suppressedBy: {
        scope: "next-line",
        reason: "intentional handoff",
      },
    });
  });
});
