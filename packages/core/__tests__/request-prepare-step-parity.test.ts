import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  loopRuntimeAdapter,
  prompt,
  tool,
  type AdapterSpec,
} from "../src";
import { fakeLoopRuntime } from "../src/adapter/testing";

const textPrompt = prompt({
  id: "prepare-step-stream-parity",
  prompt: "hello",
});

describe("prepareStep loop parity", () => {
  it("applies preparation to Core-owned streams before provider I/O", async () => {
    const calls: string[] = [];
    const spec: AdapterSpec<object, object, AsyncIterable<string>> = {
      providerId: "prepare-stream",
      async call() {
        throw new Error("not used");
      },
      async stream(_client, args) {
        calls.push(args.model);
        return {
          rawStream: (async function* () {
            yield "done";
          })(),
          extractTextDelta: (chunk) => String(chunk),
          completion: async () => ({ finishReason: "stop" }),
        };
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };
    const callback = vi.fn(() => ({ model: "model-2" }));
    const result = await adapter(spec)({}).stream(textPrompt, {
      model: "model-1",
      prepareStep: callback,
    });
    await result.completion;

    expect(callback).toHaveBeenCalledOnce();
    expect(calls).toEqual(["model-2"]);
  });

  it("applies preparation to SDK-owned streams before provider I/O", async () => {
    const fake = fakeLoopRuntime({ streams: [["done"]] });
    const callback = vi.fn(() => ({
      model: "fake:m-2",
      inputBudget: { max: 300 },
    }));
    const result = await loopRuntimeAdapter(fake.runtime).stream(textPrompt, {
      model: "fake:m-1",
      prepareStep: callback,
    });
    await result.completion();

    expect(callback).toHaveBeenCalledOnce();
    expect(fake.calls.runStream).toHaveLength(1);
  });

  it("uses the same boundary for SDK-owned structured output", async () => {
    const fake = fakeLoopRuntime({
      structured: ['{"value":"ok"}'],
    });
    const structuredPrompt = prompt({
      id: "prepare-step-structured-parity",
      output: z.object({ value: z.string() }),
      prompt: "return json",
    });
    const callback = vi.fn(() => ({
      model: "fake:m-2",
      inputBudget: { max: 300 },
    }));
    const result = await loopRuntimeAdapter(fake.runtime).generate(
      structuredPrompt,
      {
        model: "fake:m-1",
        prepareStep: callback,
      },
    );

    expect(result.object).toEqual({ value: "ok" });
    expect(result.steps[0]?.request).toMatchObject({
      model: "m-2",
      maxInputTokens: 300,
    });
    expect(callback).toHaveBeenCalledOnce();
  });

  it("makes an SDK-boundary Tool available before its first provider call", async () => {
    const fake = fakeLoopRuntime({
      loops: [[
        { toolCalls: [{ name: "lookup", args: { key: "a" } }] },
        { text: "done" },
      ]],
    });
    const lookup = tool({
      description: "Look up a value.",
      input: z.object({ key: z.string() }),
      execute: ({ key }) => `value:${key}`,
    });
    const contexts: Array<{ index: number; toolHistory: readonly unknown[] }> =
      [];
    const result = await loopRuntimeAdapter(fake.runtime).generate(textPrompt, {
      model: "fake:m-1",
      maxSteps: 2,
      prepareStep(context) {
        contexts.push({
          index: context.index,
          toolHistory: context.toolHistory,
        });
        return context.index === 0
          ? { tools: { lookup }, activeTools: ["lookup"] }
          : undefined;
      },
    });

    expect(result.text).toBe("done");
    expect(contexts).toHaveLength(2);
    expect(contexts[1]?.toolHistory).toEqual([
      expect.objectContaining({
        name: "lookup",
        result: "value:a",
      }),
    ]);
  });
});
