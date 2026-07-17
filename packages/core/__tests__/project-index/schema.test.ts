import { describe, expect, it } from "vitest";
import {
  ContractFactsSchema,
  DependencyFactsSchema,
  ProjectDefinitionKindSchema,
  ProjectDefinitionQualitySchema,
} from "../../src/project-index";

describe("Project Index schemas", () => {
  it("accepts definition kinds exposed by the public union", () => {
    expect(ProjectDefinitionKindSchema.parse("injectable")).toBe("injectable");
    expect(ProjectDefinitionKindSchema.parse("mcp.server")).toBe("mcp.server");
    expect(ProjectDefinitionKindSchema.parse("evaluation")).toBe("evaluation");
    expect(ProjectDefinitionKindSchema.parse("deferred-work")).toBe(
      "deferred-work",
    );
    expect(ProjectDefinitionKindSchema.parse("evaluation.case")).toBe(
      "evaluation.case",
    );
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

    expect(ProjectDefinitionQualitySchema.parse({ evalIds: ["eval:quality"], runCount: 4 })).toEqual({
      evalIds: ["eval:quality"],
      runCount: 4,
    });
  });
});
