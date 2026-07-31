import { describe, expect, it } from "vitest";
import {
  context,
  prefer,
  prompt,
  RequestCompositionError,
  type CallArgs,
} from "../src";
import { selectRequestCandidate } from "../src/request/planner/select";
import { selectRepresentedRequest } from "../src/request/planner/select";
import { buildRequestCandidate } from "../src/request/planner/candidates";
import { representationAdapter } from "./request-representation-harness";

describe("request representation selection stability", () => {
  it("selects lexicographic fidelity independently of enumeration order", () => {
    const request = {
      model: "model-1",
      messages: [],
      settings: {},
      extra: {},
    } satisfies CallArgs<Record<string, unknown>>;
    const candidates = [
      { fidelity: [1, 0], inputTokens: 70 },
      { fidelity: [0, 1], inputTokens: 70 },
      { fidelity: [1, 1], inputTokens: 40 },
    ].map((candidate) => ({
      request,
      fidelity: candidate.fidelity,
      inputTokens: candidate.inputTokens,
      adaptations: [],
      selections: new Map<string, number>(),
    }));

    for (let offset = 0; offset < candidates.length; offset++) {
      const shuffled = [
        ...candidates.slice(offset),
        ...candidates.slice(0, offset),
      ].reverse();
      expect(
        selectRequestCandidate(shuffled, 50, 100)?.fidelity,
      ).toEqual([1, 1]);
      expect(
        selectRequestCandidate(shuffled, 80, 100)?.fidelity,
      ).toEqual([0, 1]);
    }
  });

  it("orders fidelity by priority and then declaration order", async () => {
    const lowFull = context({
      id: "priority-low",
      priority: 10,
      system: "low-full ".repeat(40),
    });
    const highFull = context({
      id: "priority-high",
      priority: 90,
      system: "high-full ".repeat(40),
    });
    const priorityHarness = representationAdapter();
    const priorityResult = await priorityHarness.runtime.generate(
      prompt({
        id: "priority-fidelity",
        use: [
          prefer(
            lowFull,
            context({ id: "priority-low-compact", system: "low-compact" }),
          ),
          prefer(
            highFull,
            context({ id: "priority-high-compact", system: "high-compact" }),
          ),
        ],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 130, max: 250 },
      },
    );

    expect(priorityHarness.requests[0]?.system).toContain("high-full");
    expect(priorityHarness.requests[0]?.system).toContain("low-compact");
    expect(priorityResult.steps[0]?.request?.adaptations[0]).toMatchObject({
      contributor: "priority-low",
    });

    const orderHarness = representationAdapter();
    const orderResult = await orderHarness.runtime.generate(
      prompt({
        id: "declaration-fidelity",
        use: [
          prefer(
            context({
              id: "order-first",
              priority: 50,
              system: "first-full ".repeat(40),
            }),
            context({ id: "order-first-compact", system: "first-compact" }),
          ),
          prefer(
            context({
              id: "order-second",
              priority: 50,
              system: "second-full ".repeat(40),
            }),
            context({ id: "order-second-compact", system: "second-compact" }),
          ),
        ],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 140, max: 250 },
      },
    );

    expect(orderHarness.requests[0]?.system).toContain("first-full");
    expect(orderHarness.requests[0]?.system).toContain("second-compact");
    expect(orderResult.steps[0]?.request?.adaptations[0]).toMatchObject({
      contributor: "order-second",
    });
  });

  it("never alters a plain exact contributor under pressure", async () => {
    const harness = representationAdapter();
    const reply = prompt({
      id: "plain-exact-pressure",
      use: [
        context({
          id: "plain-required",
          system: "required ".repeat(100),
        }),
      ],
      prompt: "Answer.",
    });

    const error = await harness.runtime
      .generate(reply, {
        model: "model-1",
        inputBudget: { max: 30 },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "REQUEST_TOO_LARGE" });
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("adapts system instructions after an SDK folds them into messages", () => {
    const request = {
      model: "model-1",
      messages: [
        { role: "system" as const, content: "Full instructions." },
        { role: "user" as const, content: "Answer." },
      ],
      settings: {},
      extra: {},
    } satisfies CallArgs<Record<string, unknown>>;
    const candidate = buildRequestCandidate(
      request,
      [{
        contributor: "folded",
        sources: ["context:folded"],
        fullTexts: ["Full instructions."],
        priority: 50,
        declarationOrder: 0,
        ownedToolNames: [],
        ownedPolicyIds: [],
        ownedSkillIds: [],
        ownedToolMiddleware: [],
        omissionEdits: [],
        rungs: [
          { kind: "full", available: true },
          { kind: "authored", text: "Compact.", available: true },
        ],
      }],
      [1],
    );

    expect(candidate.request.messages[0]).toEqual({
      role: "system",
      content: "Compact.",
    });
  });

  it("uses authoritative counts while selecting represented requests", async () => {
    const countTokens = async (
      request: CallArgs<Record<string, unknown>>,
    ) => request.system?.includes("Compact")
      ? 40
      : request.system?.includes("Full")
        ? 90
        : 10;
    const selected = await selectRepresentedRequest({
      provider: "test",
      model: "model-1",
      requestId: "authoritative-selection",
      request: {
        model: "model-1",
        system: "Full.",
        messages: [],
        settings: {},
        extra: {},
      },
      policies: [{
        contributor: "counted",
        sources: ["context:counted"],
        fullTexts: ["Full."],
        priority: 50,
        declarationOrder: 0,
        ownedToolNames: [],
        ownedPolicyIds: [],
        ownedSkillIds: [],
        ownedToolMiddleware: [],
        omissionEdits: [],
        rungs: [
          { kind: "full", available: true },
          { kind: "authored", text: "Compact.", available: true },
        ],
      }],
      countTokens,
      optimizeAt: 50,
      max: 100,
    });

    expect(selected?.request.system).toBe("Compact.");
    expect(selected?.inputTokens).toBe(40);
    expect(selected?.counted).toBe(true);
  });

  it("prunes large droppable candidate spaces", async () => {
    const policies = Array.from({ length: 20 }, (_, index) => {
      const label = `optional-${index.toString().padStart(2, "0")}`;
      return {
        contributor: label,
        sources: [`context:${label}`],
        fullTexts: [`${label} `.repeat(1_000)],
        priority: 50,
        declarationOrder: index,
        ownedToolNames: [],
        ownedPolicyIds: [],
        ownedSkillIds: [],
        ownedToolMiddleware: [],
        omissionEdits: [],
        rungs: [
          { kind: "full" as const, available: true },
          { kind: "omitted" as const, available: true },
        ],
      };
    });
    const request = {
      model: "model-1",
      system: policies.map((policy) => policy.fullTexts[0]).join("\n\n"),
      messages: [{ role: "user" as const, content: "Answer." }],
      settings: {},
      extra: {},
    };
    const omitted = buildRequestCandidate(
      request,
      policies,
      policies.map(() => 1),
    );
    expect(omitted.adaptations).toHaveLength(20);
    expect(omitted.request.system).toBe("");
    const selected = await selectRepresentedRequest({
      provider: "test",
      model: "model-1",
      requestId: "pruned-selection",
      request,
      policies,
      optimizeAt: 500,
      max: 500,
    });

    expect(selected?.adaptations).toHaveLength(20);
    expect(selected?.request.system).toBe("");
  });
});
