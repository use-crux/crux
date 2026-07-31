import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  adapter,
  context,
  droppable,
  prefer,
  prompt,
  PreparationError,
  tool,
  type AdapterResponse,
  type AdapterSpec,
} from "../src";
import { boundary, constraint } from "../src/safety";

const stepPrompt = prompt({
  id: "request-prepare-step",
  input: z.object({ message: z.string() }),
  prompt: ({ input }) => input.message,
});

function response(text: string): AdapterResponse {
  return {
    text,
    toolCalls: undefined,
    usage: undefined,
    finishReason: "stop",
    responseId: "response-1",
    actualModelId: "model-1",
  };
}

function runtime(call = vi.fn()) {
  const spec: AdapterSpec<object, object> = {
    providerId: "prepare-step",
    capacity: () => ({
      contextWindow: 1_024,
      defaultOutputReserve: 128,
      countingConfidence: "estimated",
    }),
    async call(_client, args) {
      call(args);
      return { raw: {}, extracted: response("done") };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return { call, adapter: adapter(spec)({}) };
}

describe("prepareStep", () => {
  it("runs once before the initial provider call with an immutable context", async () => {
    const target = runtime();
    const contexts: unknown[] = [];

    const result = await target.adapter.generate(stepPrompt, {
      model: "model-1",
      input: { message: "hello" },
      prepareStep(context) {
        contexts.push(context);
        return undefined;
      },
    });

    expect(target.call).toHaveBeenCalledOnce();
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      operation: "language",
      input: { message: "hello" },
      index: 0,
      reason: "initial",
      previousReceipt: undefined,
    });
    expect(Object.isFrozen(contexts[0])).toBe(true);
    expect(Object.isFrozen((contexts[0] as { stats: object }).stats)).toBe(
      true,
    );
    const messages = (contexts[0] as { messages: readonly object[] }).messages;
    expect(Object.isFrozen(messages)).toBe(true);
    expect(Object.isFrozen(messages[0])).toBe(true);
    expect(result.steps[0]?.request?.adaptations).toEqual([]);
  });

  it("applies use, Tool, activeTools, model, and budget amendments before sealing", async () => {
    const base = context({ id: "base", system: "BASE" });
    const added = context({ id: "added", system: "ADDED" });
    const amendedPrompt = prompt({
      id: "request-prepare-step-amendment",
      use: [base],
      prompt: "hello",
    });
    const extra = tool({
      description: "Extra boundary Tool.",
      input: z.object({}),
      execute: () => "ok",
    });
    const calls: Array<{
      model: string;
      system?: string;
      tools?: readonly { name: string }[];
    }> = [];
    const spec: AdapterSpec<object, object> = {
      providerId: "prepare-step",
      capacity: () => ({
        contextWindow: 1_024,
        defaultOutputReserve: 128,
        countingConfidence: "estimated",
      }),
      async call(_client, args) {
        calls.push(args);
        return { raw: {}, extracted: response("done") };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound: (messages) => messages,
      mapSettings: () => ({}),
    };

    const result = await adapter(spec)({}).generate(amendedPrompt, {
      model: "model-1",
      prepareStep: () => ({
        use: { add: [added], remove: [{ id: "base" }] },
        tools: { extra },
        activeTools: ["extra"],
        model: "model-2",
        inputBudget: { max: 300 },
      }),
    });

    expect(calls).toEqual([
      expect.objectContaining({
        model: "model-2",
        system: "ADDED",
        tools: [expect.objectContaining({ name: "extra" })],
      }),
    ]);
    expect(result.steps[0]?.request).toMatchObject({
      model: "model-2",
      maxInputTokens: 300,
    });
    expect(await result.steps[0]?.request?.inspect()).toMatchObject({
      preparation: {
        operation: "language",
        stepIndex: 0,
        reason: "initial",
        amendment: {
          addedContributors: 1,
          removedContributors: 1,
          contributedTools: 1,
          activeTools: 1,
          modelChanged: true,
          inputBudgetChanged: true,
        },
      },
    });
    expect(
      JSON.stringify(await result.steps[0]?.request?.inspect()),
    ).not.toContain("ADDED");
  });

  it("snapshots a synchronous amendment before queued caller mutation", async () => {
    const target = runtime();
    const amendment = { model: "model-2" };

    await target.adapter.generate(stepPrompt, {
      model: "model-1",
      input: { message: "hello" },
      prepareStep() {
        queueMicrotask(() => {
          amendment.model = "model-3";
        });
        return amendment;
      },
    });

    expect(target.call).toHaveBeenCalledWith(
      expect.objectContaining({ model: "model-2" }),
    );
  });

  it("fails callback errors and the 30 second ceiling before dispatch", async () => {
    const thrown = runtime();
    const callbackError = await thrown.adapter
      .generate(stepPrompt, {
        model: "model-1",
        input: { message: "private input" },
        prepareStep: () => {
          throw new Error("private failure");
        },
      })
      .catch((error: unknown) => error);

    expect(callbackError).toBeInstanceOf(PreparationError);
    expect(callbackError).toMatchObject({
      reason: "callback",
      message: "Request preparation failed: callback.",
    });
    expect(thrown.call).not.toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      const timed = runtime();
      const pending = timed.adapter
        .generate(stepPrompt, {
          model: "model-1",
          input: { message: "private input" },
          prepareStep: () => new Promise(() => {}),
        })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);

      await expect(pending).resolves.toMatchObject({ reason: "timeout" });
      expect(timed.call).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid active Tool selection before dispatch", async () => {
    const target = runtime();
    const error = await target.adapter
      .generate(stepPrompt, {
        model: "model-1",
        input: { message: "hello" },
        prepareStep: () => ({ activeTools: ["missing"] }),
      })
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "INVALID_COMPOSITION",
      diagnostics: [
        expect.objectContaining({ code: "INVALID_EXECUTION_AMENDMENT" }),
      ],
    });
    expect(target.call).not.toHaveBeenCalled();
  });

  it("rejects protected and nested contributor removal before dispatch", async () => {
    const protectedContext = context({
      id: "protected",
      system: "Required guidance.",
      constraints: [
        constraint({
          id: "required-output",
          on: boundary.output.text(),
          run: () => ({ pass: true }),
        }),
      ],
    });
    const nested = context({ id: "nested", system: "Optional guidance." });
    const removable = droppable(nested);
    const wrappedProtected = prefer(
      protectedContext,
      context({ id: "protected-short", system: "Required." }),
    );
    const guarded = tool({
      description: "Approval-protected Tool.",
      input: z.object({}),
      execute: () => "ok",
    });
    const approvalProtected = context({
      id: "approval-protected",
      system: "Approval policy.",
      tools: { guarded },
      toolApproval: { guarded: "always" },
    });
    const target = runtime();

    for (const [use, remove] of [
      [[protectedContext], protectedContext],
      [[wrappedProtected], wrappedProtected],
      [[approvalProtected], approvalProtected],
      [[removable], nested],
    ] as const) {
      await expect(
        target.adapter.generate(
          prompt({ id: "invalid-removal", use, prompt: "hello" }),
          {
            model: "model-1",
            prepareStep: () => ({ use: { remove: [remove] } }),
          },
        ),
      ).rejects.toMatchObject({ code: "INVALID_COMPOSITION" });
    }

    expect(target.call).not.toHaveBeenCalled();
  });

  it("rejects adding and removing the same identity", async () => {
    const contributor = context({
      id: "same-identity",
      system: "Boundary context.",
    });
    const reconstructed = context({
      id: "same-identity",
      system: "Reconstructed boundary context.",
    });
    const target = runtime();

    for (const addition of [contributor, reconstructed]) {
      await expect(
        target.adapter.generate(
          prompt({
            id: "same-identity-removal",
            use: [contributor],
            prompt: "hello",
          }),
          {
            model: "model-1",
            prepareStep: () => ({
              use: { add: [addition], remove: [{ id: "same-identity" }] },
            }),
          },
        ),
      ).rejects.toMatchObject({ code: "INVALID_COMPOSITION" });
    }
    expect(target.call).not.toHaveBeenCalled();
  });
});
