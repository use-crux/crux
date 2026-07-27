import type { LanguageModel } from "ai";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { prompt, ValidationExhaustedError } from "@use-crux/core";
import { CruxAdapterError } from "@use-crux/core/adapter";
import {
  executeEvalTaskForInternalUse,
  getEvalTaskDescriptorForInternalUse,
} from "@use-crux/core/eval/internal/task";
import type { OutputOf } from "@use-crux/core/eval";
import { evalContext } from "@use-crux/core/eval";
import { withEvalContext } from "@use-crux/core/eval/testing";
import { createCruxAi, stream } from "../src";
import { scriptedGateway } from "./scripted-gateway";
import { streamEvalTimeoutPrecedenceBehavior } from "./eval-stream-timeout-precedence.behavior";

const model = {
  provider: "openai",
  modelId: "gpt-4o",
  specificationVersion: "v3",
} as unknown as LanguageModel;

describe("stream.task()", () => {
  streamEvalTimeoutPrecedenceBehavior();

  it("forwards managed Eval cancellation through the composed stream signal", async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ["context-aware"] }],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).stream.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );
    const controller = new AbortController();
    let activeTimeout: ReturnType<typeof evalContext>["timeout"] | undefined;

    await withEvalContext(
      { signal: controller.signal, timeout: { firstToken: null } },
      async () => {
        activeTimeout = evalContext().timeout;
        await executeEvalTaskForInternalUse(task, { topic: "refunds" });
      },
    );

    const providerSignal = scripted.calls.streamText[0]
      ?.abortSignal as AbortSignal;
    const reason = new Error("Eval cancelled");
    expect(providerSignal).not.toBe(controller.signal);
    controller.abort(reason);
    expect(providerSignal.aborted).toBe(true);
    expect(providerSignal.reason).toBe(reason);
    expect(activeTimeout).toEqual({ firstToken: null });
    expect(Object.isFrozen(activeTimeout)).toBe(true);
  });

  it("forwards a direct caller signal to provider execution", async () => {
    const scripted = scriptedGateway({
      streamText: [{ chunks: ["cancel-aware"] }],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const controller = new AbortController();
    const directPrompt = prompt({
      input: z.object({ topic: z.string() }),
      prompt: ({ input }) => input.topic,
    });

    await ai.stream(directPrompt, {
      model,
      input: { topic: "refunds" },
      signal: controller.signal,
    });

    const providerSignal = scripted.calls.streamText[0]
      ?.abortSignal as AbortSignal;
    const reason = new Error("caller cancelled");
    expect(providerSignal).not.toBe(controller.signal);
    expect(providerSignal.aborted).toBe(false);

    controller.abort(reason);

    expect(providerSignal.aborted).toBe(true);
    expect(providerSignal.reason).toBe(reason);
  });

  it("preserves production streaming and drains a complete text Eval once", async () => {
    const scripted = scriptedGateway({
      streamText: [
        { chunks: ["Pro", "duction"] },
        { chunks: ["Eval", "uation"] },
      ],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).stream.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model, temperature: 0.2 },
    );

    const production = await task({ topic: "production" });
    expect("raw" in production).toBe(false);
    expect(scripted.calls.streamText).toHaveLength(1);

    let productionText = "";
    for await (const delta of production.textStream) productionText += delta;
    expect(productionText).toBe("Production");
    expect((await production.completion).text).toBe("Production");

    const evaluation = await executeEvalTaskForInternalUse(task, {
      topic: "evaluation",
    });
    expect(evaluation.output).toBe("Evaluation");
    expect(evaluation.response.text).toBe("Evaluation");
    expect(evaluation.response).not.toHaveProperty("raw");
    expect(scripted.calls.streamText).toHaveLength(2);
    expect(getEvalTaskDescriptorForInternalUse(task)).toMatchObject({
      operation: "stream",
      adapterId: "ai-sdk",
    });
    expect(task._tag).toBe("CruxTask");
    expect(task.operation).toBe("stream");
    expectTypeOf<OutputOf<typeof task>>().toEqualTypeOf<string>();
  });

  it("attaches the factory to root and custom stream callables", () => {
    expect(stream.task).toBeTypeOf("function");
    expect(createCruxAi().stream.task).toBeTypeOf("function");
  });

  it("projects only a fully completed structured stream", async () => {
    const productionObject = { answer: "Production" };
    const evalObject = { answer: "Evaluation" };
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ['{"answer":"Production"}'],
          finish: { object: productionObject },
        },
        {
          chunks: ['{"answer":"Evaluation"}'],
          finish: { object: evalObject },
        },
      ],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).stream.task(
      prompt({
        id: "structured-stream",
        input: z.object({ topic: z.string() }),
        output: z.object({ answer: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );

    const production = await task({ topic: "production" });
    for await (const _delta of production.textStream) {
      // Production owns and drains its stream normally.
    }
    expect((await production.completion).object).toEqual(productionObject);

    const evaluation = await executeEvalTaskForInternalUse(task, {
      topic: "evaluation",
    });
    expect(evaluation.output).toEqual(evalObject);
    expect(evaluation.response.object).toEqual(evalObject);
    expect(evaluation.response.text).toBe('{"answer":"Evaluation"}');
    expect(evaluation.response).not.toHaveProperty("raw");
    expectTypeOf<OutputOf<typeof task>>().toEqualTypeOf<{
      answer: string;
    }>();
  });

  it("rejects absent structured output and partial stream failures", async () => {
    const scripted = scriptedGateway({
      streamText: [
        // structuredTask: an empty object cannot satisfy the schema.
        { chunks: ["{}"], finish: { output: {} } },
        {
          chunks: ["partial"],
          errorAfterChunks: new Error("connection reset"),
        },
        {
          chunks: [],
          errorAfterChunks: Object.assign(new Error("user aborted"), {
            name: "AI_AbortError",
          }),
        },
      ],
    });
    const ai = createCruxAi({ gateway: scripted.gateway });
    const structuredTask = ai.stream.task(
      prompt({
        id: "missing-stream-object",
        input: z.object({ topic: z.string() }),
        output: z.object({ answer: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );
    const textTask = ai.stream.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );
    const abortedTask = ai.stream.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );

    // The completed structured stream now runs the same terminal invariant as
    // generation: an empty object cannot satisfy the schema, so the stream
    // throws its validation failure rather than returning an absent object.
    await expect(
      executeEvalTaskForInternalUse(structuredTask, { topic: "missing" }),
    ).rejects.toBeInstanceOf(ValidationExhaustedError);
    await expect(
      executeEvalTaskForInternalUse(textTask, { topic: "partial" }),
    ).rejects.toBeInstanceOf(CruxAdapterError);
    await expect(
      executeEvalTaskForInternalUse(abortedTask, { topic: "abort" }),
    ).rejects.toMatchObject({
      providerError: { kind: "aborted", retryable: false },
    });
    expect(scripted.calls.streamText).toHaveLength(3);
  });

  it("retains complete content and tool-call evidence", async () => {
    const scripted = scriptedGateway({
      streamText: [
        {
          chunks: ["Evidence"],
          finish: {
            content: [{ type: "text", text: "Evidence" }],
            toolCalls: [
              {
                toolCallId: "call-1",
                toolName: "lookup",
                input: { query: "refund" },
              },
            ],
          },
        },
      ],
    });
    const task = createCruxAi({ gateway: scripted.gateway }).stream.task(
      prompt({
        input: z.object({ topic: z.string() }),
        prompt: ({ input }) => input.topic,
      }),
      { model },
    );

    const evaluation = await executeEvalTaskForInternalUse(task, {
      topic: "evidence",
    });
    expect(evaluation.output).toBe("Evidence");
    expect(evaluation.response.content).toEqual([
      { type: "text", text: "Evidence" },
    ]);
    expect(evaluation.response.finalStep.toolCalls).toEqual([
      { id: "call-1", name: "lookup", args: { query: "refund" } },
    ]);
    expect(scripted.calls.streamText).toHaveLength(1);
  });
});
