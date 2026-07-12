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

    expect(
      ProjectDefinitionQualitySchema.parse({
        drift: {
          evals: [
            {
              id: "eval:quality",
              passRate: 0.75,
              runs: 4,
              baselineExperimentId: "baseline",
              baselinePassRate: 1,
              driftPp: -25,
            },
          ],
          suites: [],
        },
      }),
    ).toMatchObject({
      drift: {
        evals: [{ id: "eval:quality", driftPp: -25 }],
        suites: [],
      },
    });
  });
});
