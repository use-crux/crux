import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  context,
  droppable,
  loopRuntimeAdapter,
  prefer,
  prompt,
  tool,
  type LoopRuntimePort,
} from "../src";
import { boundary, constraint, guardrail } from "../src/safety";
import { representationAdapter } from "./request-representation-harness";

describe("request representation safety", () => {
  it("guards the selected authored alternative before provider dispatch", async () => {
    const full = context({
      id: "guarded-full",
      system: "Detailed safe guidance. ".repeat(100),
      guardrails: [
        guardrail({
          id: "rewrite-selected-instructions",
          on: boundary.input.instructions(),
          run: (text) =>
            text.includes("sensitive alternative")
              ? {
                  action: "rewrite",
                  value: text.replace(
                    "sensitive alternative",
                    "safe alternative",
                  ),
                  rewrite: { kind: "redact" },
                }
              : { action: "allow" },
        }),
      ],
    });
    const compact = context({
      id: "guarded-compact",
      system: "sensitive alternative",
    });
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "guarded-authored-alternative",
        use: [prefer(full, compact)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 80, max: 300 },
      },
    );

    expect(harness.call).toHaveBeenCalledOnce();
    expect(harness.requests[0]?.system).toContain("safe alternative");
    expect(harness.requests[0]?.system).not.toContain(
      "sensitive alternative",
    );
  });

  it("guards an alternative after SDK system-message folding", async () => {
    let plannedSystem = "";
    const runtime: LoopRuntimePort<string, object> = {
      id: "folded-representation-safety",
      capabilities: { requestPlanning: "per-step" },
      capacity: () => ({
        contextWindow: 2_048,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      describeModel: (model) => ({
        provider: "folded-representation-safety",
        modelId: model,
      }),
      mapSettings: (settings) => ({ ...settings }),
      async runTextLoop(request) {
        const planned = await request.planStep!({
          model: request.model,
          modelInfo: request.modelInfo,
          system: undefined,
          systemBlocks: undefined,
          messages: [
            { role: "system", content: request.system ?? "" },
            { role: "user", content: "Answer." },
          ],
        });
        plannedSystem = String(planned.messages[0]?.content ?? "");
        return {
          status: "complete",
          raw: {},
          response: {
            text: "done",
            usage: undefined,
            finishReason: "stop",
            responseId: "response-1",
            actualModelId: "model-1",
          },
          messages: [{ role: "assistant", content: "done" }],
          steps: 1,
          stepFacts: [{
            request: planned.receipt,
            content: [{ type: "text", text: "done" }],
            finishReason: "stop",
            responseId: "response-1",
            modelId: "model-1",
          }],
          meta: {},
        };
      },
      async runStructuredAttempt() {
        throw new Error("not used");
      },
      async runStream() {
        throw new Error("not used");
      },
    };
    const full = context({
      id: "folded-full",
      system: "Detailed safe guidance. ".repeat(100),
      guardrails: [
        guardrail({
          id: "rewrite-folded-instructions",
          on: boundary.input.instructions(),
          run: (text) =>
            text.includes("sensitive folded alternative")
              ? {
                  action: "rewrite",
                  value: text.replace(
                    "sensitive folded alternative",
                    "safe folded alternative",
                  ),
                  rewrite: { kind: "redact" },
                }
              : { action: "allow" },
        }),
      ],
    });

    await loopRuntimeAdapter(runtime).generate(
      prompt({
        id: "guarded-folded-alternative",
        use: [
          prefer(
            full,
            context({
              id: "folded-compact",
              system: "sensitive folded alternative",
            }),
          ),
        ],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 80, max: 300 },
      },
    );

    expect(plannedSystem).toContain("safe folded alternative");
    expect(plannedSystem).not.toContain("sensitive folded alternative");
  });

  it("omits a canonical context subtree and its owned tools atomically", async () => {
    const nestedTool = tool({
      description: "Nested capability.",
      input: z.object({}),
      execute: () => "done",
    });
    const nested = context({
      id: "nested-optional",
      system: "Nested optional guidance. ".repeat(100),
      tools: { nestedTool },
    });
    const root = context({
      id: "root-optional",
      use: [nested],
      system: "Root optional guidance.",
    });
    const harness = representationAdapter();

    await harness.runtime.generate(
      prompt({
        id: "atomic-subtree-omission",
        use: [droppable(root)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 20, max: 30 },
      },
    );

    expect(harness.requests[0]?.system ?? "").not.toContain(
      "optional guidance",
    );
    expect(harness.requests[0]?.tools).toEqual([]);
  });

  it("removes owned guardrails with an omitted contributor", async () => {
    const harness = representationAdapter();
    const optional = context({
      id: "guardrail-owner",
      system: "Optional guarded guidance. ".repeat(100),
      guardrails: [
        guardrail({
          id: "omitted-output-blocker",
          on: boundary.output.text(),
          run: () => ({ action: "block", reason: "still active" }),
        }),
      ],
    });

    await expect(
      harness.runtime.generate(
        prompt({
          id: "guardrail-omission",
          use: [droppable(optional)],
          prompt: "Answer.",
        }),
        {
          model: "model-1",
          inputBudget: { optimizeAt: 20, max: 30 },
        },
      ),
    ).resolves.toMatchObject({ text: "done" });
  });

  it("keeps owned guardrails when a droppable contributor remains", async () => {
    const harness = representationAdapter();
    const optional = context({
      id: "retained-guardrail-owner",
      system: "Short guarded guidance.",
      guardrails: [
        guardrail({
          id: "retained-output-blocker",
          on: boundary.output.text(),
          run: () => ({ action: "block", reason: "retained" }),
        }),
      ],
    });

    await expect(
      harness.runtime.generate(
        prompt({
          id: "guardrail-retention",
          use: [droppable(optional)],
          prompt: "Answer.",
        }),
        {
          model: "model-1",
          inputBudget: { optimizeAt: 300, max: 400 },
        },
      ),
    ).rejects.toThrow();
  });

  it("removes owned constraints with an omitted contributor", async () => {
    const check = vi.fn(() => ({ pass: true as const }));
    const harness = representationAdapter();
    const optional = context({
      id: "constraint-owner",
      system: "Optional constrained guidance. ".repeat(100),
      constraints: [
        constraint({
          id: "omitted-output-check",
          on: boundary.output.text(),
          run: check,
        }),
      ],
    });

    await harness.runtime.generate(
      prompt({
        id: "constraint-omission",
        use: [droppable(optional)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 20, max: 30 },
      },
    );

    expect(check).not.toHaveBeenCalled();
  });
});
