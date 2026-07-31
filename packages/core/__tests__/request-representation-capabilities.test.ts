import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  context,
  contributor,
  droppable,
  prompt,
  tool,
} from "../src";
import { skill } from "../src/skill";
import { readSkillActivationSession } from "../src/adapter/tool/resolved";
import { selectRepresentationSkills } from "../src/adapter/execution/representation-safety";
import { compilePrompt } from "../src/resolver/compile";
import type { ToolMiddleware } from "../src/tools/types";
import { representationAdapter } from "./request-representation-harness";

describe("request representation capability ownership", () => {
  it("removes tools produced dynamically inside an omitted subtree", async () => {
    const dynamicTool = tool({
      description: "Runtime-contributed capability.",
      input: z.object({}),
      execute: () => "done",
    });
    const dynamic = contributor({
      id: "dynamic-optional-capability",
      contribute: () => ({ tools: { dynamicTool } }),
    });
    const optional = context({
      id: "dynamic-optional-root",
      use: [dynamic],
      system: "Optional runtime guidance. ".repeat(100),
    });
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "dynamic-capability-omission",
        use: [droppable(optional)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 20, max: 30 },
      },
    );

    expect(harness.requests[0]?.tools).toEqual([]);
  });

  it("removes a nested skill index, loaders, and activation access", async () => {
    const optionalSkill = skill.inline({
      id: "optional-research",
      description: "Optional research procedure",
      instructions: "Use the private research procedure.",
    });
    const retainedSkill = skill.inline({
      id: "retained-writing",
      description: "Required writing procedure",
      instructions: "Use the required writing procedure.",
    });
    const optional = context({
      id: "skill-optional-root",
      use: [optionalSkill],
      system: "Optional skill guidance. ".repeat(100),
    });
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "skill-capability-omission",
        use: [retainedSkill, droppable(optional)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 700, max: 1_200 },
      },
    );

    expect(harness.requests[0]?.system ?? "").not.toContain(
      "optional-research",
    );
    expect(harness.requests[0]?.system ?? "").toContain("retained-writing");
    expect(harness.requests[0]?.tools).toHaveLength(2);

    const resolution = await compilePrompt({
      system: "Answer.",
      use: [retainedSkill, droppable(optional)],
    }).resolve();
    const resolved = resolution.args;
    const policies = resolved.representations ?? [];
    const policy = policies[0]!;
    const omitted = policy.rungs.findIndex((rung) => rung.kind === "omitted");
    selectRepresentationSkills(
      resolved,
      policies,
      new Map([[policy.contributor, omitted]]),
    );
    const session = readSkillActivationSession(resolved)!;
    expect(session.activate("optional-research").status).toBe("not-found");
    expect(session.activate("retained-writing").status).toBe("activated");
  });

  it("projects multiple omitted skill roots as one shared capability set", async () => {
    const firstSkill = skill.inline({
      id: "optional-first",
      description: "First optional procedure",
      instructions: "Use the first optional procedure.",
    });
    const secondSkill = skill.inline({
      id: "optional-second",
      description: "Second optional procedure",
      instructions: "Use the second optional procedure.",
    });
    const first = context({
      id: "first-skill-root",
      use: [firstSkill],
      system: "First optional guidance. ".repeat(100),
    });
    const second = context({
      id: "second-skill-root",
      use: [secondSkill],
      system: "Second optional guidance. ".repeat(100),
    });
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "aggregate-skill-omission",
        use: [droppable(first), droppable(second)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 20, max: 30 },
      },
    );

    expect(harness.requests[0]?.system ?? "").not.toContain("optional-first");
    expect(harness.requests[0]?.system ?? "").not.toContain("optional-second");
    expect(harness.requests[0]?.tools).toEqual([]);
  });

  it("removes and restores runtime-contributed middleware with its owner", async () => {
    const wrapTool = vi.fn();
    const middleware: ToolMiddleware = {
      _tag: "ToolMiddleware",
      id: "optional-runtime-middleware",
      wrapTool: (_toolName, value) => {
        wrapTool();
        return value;
      },
    };
    const dynamic = contributor({
      id: "dynamic-optional-middleware",
      contribute: () => ({ toolMiddleware: middleware }),
    });
    const optional = context({
      id: "middleware-optional-root",
      use: [dynamic],
      system: "Optional middleware guidance. ".repeat(150),
    });
    const retainedTool = tool({
      description: "Always available.",
      input: z.object({}),
      execute: () => "done",
    });
    const retained = context({
      id: "retained-tool-root",
      system: "Retained tool guidance.",
      tools: { retainedTool },
    });

    await representationAdapter().runtime.generate(
      prompt({
        id: "middleware-omission",
        use: [retained, droppable(optional)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 300, max: 500 },
      },
    );
    expect(wrapTool).not.toHaveBeenCalled();

    await representationAdapter().runtime.generate(
      prompt({
        id: "middleware-retention",
        use: [retained, droppable(optional)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 5_000, max: 6_000 },
      },
    );
    expect(wrapTool).toHaveBeenCalled();
  });
});
