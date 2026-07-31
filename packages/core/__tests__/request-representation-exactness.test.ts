import { describe, expect, it } from "vitest";
import { context, droppable, prompt } from "../src";
import { buildRequestCandidate } from "../src/request/planner/candidates";
import type { ResolvedRepresentationPolicy } from "../src/request/representation/ladder-types";
import { representationAdapter } from "./request-representation-harness";

describe("request representation exactness", () => {
  it("preserves unrelated caller whitespace at full fidelity", async () => {
    const exact = "  caller-owned\n\n\nsystem text  ";
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "full-representation-exactness",
        use: [
          droppable(
            context({
              id: "small-droppable",
              system: "Small optional context.",
            }),
          ),
        ],
        prompt: "unused",
      }),
      {
        model: "model-1",
        messages: [
          { role: "system", content: exact },
          { role: "user", content: "Answer." },
        ],
        inputBudget: { optimizeAt: 1_000, max: 1_200 },
      },
    );

    expect(harness.requests[0]?.messages[0]?.content).toBe(exact);
  });

  it("treats an empty owned source as a no-op during omission", () => {
    const policy: ResolvedRepresentationPolicy = {
      contributor: "empty-source",
      sources: ["context:empty-source"],
      fullTexts: [""],
      priority: 50,
      declarationOrder: 0,
      ownedToolNames: [],
      ownedPolicyIds: [],
      ownedSkillIds: [],
      ownedToolMiddleware: [],
      omissionEdits: [],
      rungs: [
        { kind: "full", available: true },
        { kind: "omitted", available: true },
      ],
    };
    const exact = "\n\ncaller-owned";

    const candidate = buildRequestCandidate(
      {
        model: "model-1",
        system: exact,
        messages: [],
        settings: {},
        extra: {},
      },
      [policy],
      [1],
    );

    expect(candidate.request.system).toBe(exact);
  });
});
