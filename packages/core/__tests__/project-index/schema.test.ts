import { describe, expect, it } from "vitest";
import {
  ContractFactsSchema,
  DependencyFactsSchema,
  IndexLintFindingSchema,
  ProjectDefinitionKindSchema,
  ProjectIndexSnapshotSchema,
  ProjectSourceRefSchema,
  PromptTextSourceKindSchema,
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

  it("preserves canonical prompt-text metadata during source-ref parsing", () => {
    expect(
      ProjectSourceRefSchema.parse({
        id: "prompt:support:source:prompt:prompt:prompt-text:src-support:1:1",
        role: "prompt",
        property: "prompt",
        source: { file: "src/support.ts", line: 1, column: 1 },
        fidelity: "resolved",
        metadata: {
          promptText: {
            tag: "md",
            language: "markdown",
            lifecycle: "static",
            sourceKind: "owner",
            fragmentJoins: [
              {
                kind: "named-fragment",
                ownerSourceRefId: "owner",
                ownerTemplateRange: {
                  file: "src/support.ts",
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 20,
                },
                interpolationIndex: 0,
                expressionRange: {
                  file: "src/support.ts",
                  startLine: 1,
                  startColumn: 8,
                  endLine: 1,
                  endColumn: 16,
                },
                targetSourceRefId: "target",
                targetTemplateRange: {
                  file: "src/shared.ts",
                  startLine: 2,
                  startColumn: 3,
                  endLine: 2,
                  endColumn: 15,
                },
                proof: "semantic-exact",
              },
            ],
          },
        },
      }).metadata?.promptText,
    ).toEqual({
      tag: "md",
      language: "markdown",
      lifecycle: "static",
      sourceKind: "owner",
      fragmentJoins: [
        {
          kind: "named-fragment",
          ownerSourceRefId: "owner",
          ownerTemplateRange: {
            file: "src/support.ts",
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 20,
          },
          interpolationIndex: 0,
          expressionRange: {
            file: "src/support.ts",
            startLine: 1,
            startColumn: 8,
            endLine: 1,
            endColumn: 16,
          },
          targetSourceRefId: "target",
          targetTemplateRange: {
            file: "src/shared.ts",
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 15,
          },
          proof: "semantic-exact",
        },
      ],
    });
  });

  it("requires the compiler-owned prompt-text source classification", () => {
    expect(PromptTextSourceKindSchema.parse("named-fragment")).toBe(
      "named-fragment",
    );
    const sourceRef = {
      id: "prompt:support:source:prompt:prompt:prompt-text:src-support:1:1",
      role: "prompt",
      property: "prompt",
      source: { file: "src/support.ts", line: 1, column: 1 },
      fidelity: "resolved",
      metadata: {
        promptText: {
          tag: "md",
          language: "markdown",
          lifecycle: "static",
        },
      },
    };

    expect(() => ProjectSourceRefSchema.parse(sourceRef)).toThrow();
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        metadata: {
          promptText: {
            ...sourceRef.metadata.promptText,
            sourceKind: "fragment",
          },
        },
      }),
    ).toThrow();
  });

  it("requires source classification and symbol evidence to agree", () => {
    const sourceRef = {
      id: "prompt:support:source:prompt:prompt:prompt-text:src-support:1:1",
      role: "prompt",
      property: "prompt",
      source: { file: "src/support.ts", line: 1, column: 1 },
      fidelity: "resolved",
      metadata: {
        promptText: {
          tag: "md",
          language: "markdown",
          lifecycle: "static",
          sourceKind: "named-fragment",
        },
      },
    };

    expect(() => ProjectSourceRefSchema.parse(sourceRef)).toThrow();
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        symbol: "shared",
      }),
    ).not.toThrow();
    for (const sourceKind of ["owner", "anonymous-fragment"] as const) {
      expect(() =>
        ProjectSourceRefSchema.parse({
          ...sourceRef,
          symbol: "shared",
          metadata: {
            promptText: {
              ...sourceRef.metadata.promptText,
              sourceKind,
            },
          },
        }),
      ).toThrow();
    }
  });

  it("requires canonical PromptText source-ref cross-field evidence", () => {
    const sourceRef = {
      id: "prompt:support:source:prompt:prompt:prompt-text:src-support:1:1",
      role: "prompt",
      property: "prompt",
      source: { file: "src/support.ts", line: 1, column: 1 },
      fidelity: "resolved",
      metadata: {
        promptText: {
          tag: "md",
          language: "markdown",
          lifecycle: "static",
          sourceKind: "owner",
        },
      },
    } as const;

    expect(() => ProjectSourceRefSchema.parse(sourceRef)).not.toThrow();
    for (const invalid of [
      { ...sourceRef, fidelity: "partial" },
      { ...sourceRef, property: "system" },
      { ...sourceRef, role: "description", property: "description" },
    ]) {
      expect(() => ProjectSourceRefSchema.parse(invalid)).toThrow();
    }
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        metadata: {
          promptText: {
            ...sourceRef.metadata.promptText,
            privateCompilerState: true,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        metadata: {
          promptText: {
            ...sourceRef.metadata.promptText,
            fragmentJoins: [
              {
                kind: "named-fragment",
                ownerSourceRefId: sourceRef.id,
                ownerTemplateRange: {
                  file: "src/support.ts",
                  startLine: 1,
                  startColumn: 1,
                  endLine: 1,
                  endColumn: 10,
                },
                interpolationIndex: 0,
                expressionRange: {
                  file: "src/support.ts",
                  startLine: 1,
                  startColumn: 5,
                  endLine: 1,
                  endColumn: 8,
                },
                targetSourceRefId: "fragment",
                targetTemplateRange: {
                  file: "src/support.ts",
                  startLine: 2,
                  startColumn: 1,
                  endLine: 2,
                  endColumn: 10,
                },
                proof: "semantic-exact",
                privateCompilerState: true,
              },
            ],
          },
        },
      }),
    ).toThrow();
  });

  it("strictly validates insertion-ready prompt-text refactor evidence", () => {
    const sourceRef = {
      id: "prompt:writer:source:prompt:prompt:prompt-text-refactor:src-writer:1:1",
      role: "prompt",
      property: "prompt",
      source: { file: "src/writer.ts", line: 1, column: 1 },
      fidelity: "resolved",
      metadata: {
        promptTextRefactor: {
          kind: "ordinary-string-to-md",
          proof: "semantic-exact",
          lifecycle: "static",
          target: "md",
          binding: { kind: "namespace-access", expression: "core.md" },
        },
      },
    } as const;
    expect(
      ProjectSourceRefSchema.parse(sourceRef).metadata?.promptTextRefactor,
    ).toEqual(sourceRef.metadata.promptTextRefactor);
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        metadata: {
          promptTextRefactor: {
            ...sourceRef.metadata.promptTextRefactor,
            extra: true,
          },
        },
      }),
    ).toThrow();
    expect(() =>
      ProjectSourceRefSchema.parse({
        ...sourceRef,
        metadata: {
          promptTextRefactor: {
            ...sourceRef.metadata.promptTextRefactor,
            binding: { kind: "identifier", expression: "core.md" },
          },
        },
      }),
    ).toThrow();
    for (const invalid of [
      { ...sourceRef, fidelity: "partial" },
      { ...sourceRef, property: "system" },
      { ...sourceRef, role: "description", property: "description" },
      {
        ...sourceRef,
        metadata: {
          ...sourceRef.metadata,
          promptText: {
            tag: "md",
            language: "markdown",
            lifecycle: "static",
            sourceKind: "owner",
          },
        },
      },
    ]) {
      expect(() => ProjectSourceRefSchema.parse(invalid)).toThrow();
    }
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
