/** Per-step language output Safety through SDK loop runtimes. */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { loopRuntimeAdapter } from "../../src/adapter/define-executor";
import { fakeLoopRuntime } from "../../src/adapter/testing";
import { fallback } from "../../src/generation/fallback";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

describe("language step Safety — SDK continuation", () => {
  it("blocks an intermediate step before its client tool, observer, or continuation", async () => {
    const execute = vi.fn(async () => "tool result");
    const observe = vi.fn(async () => ({ kind: "continue" as const }));
    const seen: string[] = [];
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "unsafe intermediate",
            toolCalls: [{ id: "call-1", name: "lookup", args: { query: "x" } }],
          },
          { text: "must not continue" },
        ],
      ],
    });
    const runtime = loopRuntimeAdapter({
      ...fake.runtime,
      capabilities: {
        requestPlanning: "per-step",
        stepTransform: "before-client-tools",
      },
    });

    await expect(
      runtime.generate(textPrompt(), {
        model: "fake:test-model",
        input: { message: "go" },
        tools: { lookup: { description: "lookup", execute } },
        observer: { onStepEnd: observe },
        guardrails: [
          guardrail({
            id: "block-sdk-intermediate-text",
            on: boundary.output.text(),
            run: (text) => {
              seen.push(text);
              return { action: "block", reason: "unsafe" };
            },
          }),
        ],
      }),
    ).rejects.toThrow("block-sdk-intermediate-text");

    expect(seen).toEqual(["unsafe intermediate"]);
    expect(execute).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
  });

  it("orders transform before client tools and observation exactly once per model step", async () => {
    const events: string[] = [];
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "unsafe intermediate",
            toolCalls: [{ id: "call-1", name: "lookup", args: { query: "x" } }],
          },
          { text: "done" },
        ],
      ],
    });
    const runtime = loopRuntimeAdapter(fake.runtime);

    const result = await runtime.generate(textPrompt(), {
      model: "fake:test-model",
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          execute: async () => {
            events.push("tool");
            return "tool result";
          },
        },
      },
      observer: {
        onStepEnd: async (step) => {
          events.push(`observer:${step.text}`);
          return { kind: "continue" };
        },
      },
      guardrails: [
        guardrail({
          id: "rewrite-sdk-intermediate-text",
          on: boundary.output.text(),
          run: (text) => {
            events.push(`guard:${text}`);
            return text === "unsafe intermediate"
              ? {
                  action: "rewrite",
                  value: "safe intermediate",
                  rewrite: { kind: "normalize" },
                }
              : { action: "allow" };
          },
        }),
      ],
    });

    expect(events).toEqual([
      "guard:unsafe intermediate",
      "tool",
      "observer:safe intermediate",
      "guard:done",
      "observer:done",
    ]);
    expect(result.text).toBe("safe intermediatedone");
    expect(result.steps.map((step) => step.text)).toEqual([
      "safe intermediate",
      "done",
    ]);
  });

  it("never routes around a terminal step-policy failure", async () => {
    const onFallback = vi.fn();
    const fake = fakeLoopRuntime({
      loops: [[{ text: "unsafe" }], [{ text: "safe but unreachable" }]],
    });

    await expect(
      loopRuntimeAdapter(fake.runtime).generate(textPrompt(), {
        model: fallback(["fake:first", "fake:second"], {
          shouldFallback: () => true,
          onFallback,
        }),
        input: { message: "go" },
        guardrails: [
          guardrail({
            id: "block-routed-language-step",
            on: boundary.output.text(),
            run: () => ({ action: "block", reason: "unsafe" }),
          }),
        ],
      }),
    ).rejects.toThrow("block-routed-language-step");

    expect(fake.calls.runTextLoop).toHaveLength(1);
    expect(onFallback).not.toHaveBeenCalled();
  });
});

function textPrompt() {
  return prompt({
    id: "language-step-sdk-output",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
  });
}
