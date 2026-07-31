import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  context,
  droppable,
  offload,
  offloadable,
  prefer,
  prompt,
  RequestCompositionError,
  tool,
  type ContextEntry,
} from "../src";
import { representationAdapter } from "./request-representation-harness";

describe("request representation policy", () => {
  it("rejects dynamically constructed order-reversing ladders at definition preflight", () => {
    const source = context({ id: "dynamic-source", system: "Exact." });
    const malformed = {
      _tag: "summarizable",
      source: {
        _tag: "droppable",
        source,
      },
      options: {},
    } as unknown as ContextEntry;

    expect(() =>
      prompt({
        id: "dynamic-invalid-ladder",
        use: [malformed],
        prompt: "Hello.",
      }),
    ).toThrowError(
      expect.objectContaining<RequestCompositionError>({
        code: "INVALID_COMPOSITION",
      }),
    );
  });

  it("selects an authored alternative under pressure and receipts both sizes", async () => {
    const harness = representationAdapter();
    const full = context({
      id: "policy-full",
      system: "Detailed policy guidance. ".repeat(120),
    });
    const compact = context({
      id: "policy-compact",
      system: "Compact policy.",
    });
    const reply = prompt({
      id: "authored-alternative",
      use: [prefer(full, compact)],
      prompt: "Answer.",
    });

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      inputBudget: { optimizeAt: 80, max: 300 },
    });

    expect(harness.call).toHaveBeenCalledOnce();
    expect(harness.requests[0]?.system).toContain("Compact policy.");
    expect(harness.requests[0]?.system).not.toContain(
      "Detailed policy guidance.",
    );
    expect(result.steps[0]?.request?.adaptations).toEqual([
      expect.objectContaining({
        contributor: "policy-full",
        representation: "authored",
        fullTokens: expect.any(Number),
        selectedTokens: expect.any(Number),
      }),
    ]);
    expect(
      result.steps[0]?.request?.adaptations[0]?.fullTokens,
    ).toBeGreaterThan(
      result.steps[0]?.request?.adaptations[0]?.selectedTokens ?? 0,
    );
  });

  it("keeps the full representation when it fits the optimization tier", async () => {
    const harness = representationAdapter();
    const full = context({
      id: "small-full",
      system: "Full policy.",
    });
    const compact = context({
      id: "small-compact",
      system: "Short.",
    });
    const reply = prompt({
      id: "authored-full-fit",
      use: [prefer(full, compact)],
      prompt: "Answer.",
    });

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      inputBudget: { optimizeAt: 200, max: 300 },
    });

    expect(harness.requests[0]?.system).toContain("Full policy.");
    expect(result.steps[0]?.request?.adaptations).toEqual([]);
  });

  it("omits only after authored rungs cannot fit", async () => {
    const harness = representationAdapter();
    const full = context({
      id: "droppable-full",
      system: "Full optional guidance. ".repeat(120),
    });
    const compact = context({
      id: "droppable-compact",
      system: "Compact optional guidance. ".repeat(80),
    });
    const reply = prompt({
      id: "terminal-omission",
      use: [droppable(prefer(full, compact))],
      prompt: "Answer.",
    });

    const result = await harness.runtime.generate(reply, {
      model: "model-1",
      inputBudget: { optimizeAt: 20, max: 30 },
    });

    expect(harness.requests[0]?.system ?? "").not.toContain(
      "optional guidance",
    );
    expect(result.steps[0]?.request?.adaptations).toEqual([
      expect.objectContaining({
        contributor: "droppable-full",
        representation: "omitted",
      }),
    ]);
  });

  it("keeps primary tools for alternatives and removes them on omission", async () => {
    const lookup = tool({
      description: "Look up a value.",
      input: z.object({ key: z.string() }),
      execute: ({ key }) => key,
    });
    const full = context({
      id: "capability-full",
      system: "Full capability guidance. ".repeat(100),
      tools: { lookup },
    });
    const compact = context({
      id: "capability-compact",
      system: "Compact capability guidance.",
    });

    const retainedHarness = representationAdapter();
    await retainedHarness.runtime.generate(
      prompt({
        id: "capability-retained",
        use: [prefer(full, compact)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 80, max: 300 },
      },
    );
    expect(retainedHarness.requests[0]?.tools?.map((item) => item.name)).toEqual(
      ["lookup"],
    );

    const omittedHarness = representationAdapter();
    await omittedHarness.runtime.generate(
      prompt({
        id: "capability-omitted",
        use: [droppable(full)],
        prompt: "Answer.",
      }),
      {
        model: "model-1",
        inputBudget: { optimizeAt: 20, max: 30 },
      },
    );
    expect(omittedHarness.requests[0]?.tools ?? []).toEqual([]);
  });

  it("rejects an alternative that declares different capabilities", async () => {
    const firstTool = tool({
      description: "First.",
      input: z.object({}),
      execute: () => "first",
    });
    const secondTool = tool({
      description: "Second.",
      input: z.object({}),
      execute: () => "second",
    });
    const harness = representationAdapter();
    const reply = prompt({
      id: "capability-mismatch",
      use: [
        prefer(
          context({
            id: "capability-primary",
            system: "Primary.",
            tools: { firstTool },
          }),
          context({
            id: "capability-alternative",
            system: "Alternative.",
            tools: { secondTool },
          }),
        ),
      ],
      prompt: "Answer.",
    });

    const error = await harness.runtime
      .generate(reply, { model: "model-1" })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "INVALID_COMPOSITION" });
    expect(JSON.stringify(error)).not.toContain("Primary.");
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("reports an exact-recovery rung without backing honestly", async () => {
    const use = offloadable(
      context({
        id: "reference-unavailable",
        system: "Large reference source. ".repeat(100),
      }),
    );
    const harness = representationAdapter();
    const reply = prompt({
      id: "unavailable-offloadable",
      use: [use],
      prompt: "Answer.",
    });
    const error = await harness.runtime
      .generate(reply, {
        model: "model-1",
        inputBudget: { max: 30 },
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({
      code: "REPRESENTATION_UNAVAILABLE",
    });
    expect(harness.call).not.toHaveBeenCalled();
  });

  it("fails forced offload without backing and redacts the value", async () => {
    const harness = representationAdapter();
    const secret = "private-forced-offload-value";
    const reply = prompt({
      id: "forced-offload-unavailable",
      use: [offload(secret)],
      prompt: "Answer.",
    });

    const error = await harness.runtime
      .generate(reply, { model: "model-1" })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RequestCompositionError);
    expect(error).toMatchObject({ code: "REPRESENTATION_UNAVAILABLE" });
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(harness.call).not.toHaveBeenCalled();
  });
});
