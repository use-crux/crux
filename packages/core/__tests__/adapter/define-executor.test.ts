/**
 * Tests for `loopRuntimeAdapter()` — the factory for loop-owning adapters.
 *
 * Uses `fakeLoopRuntime()` (the in-memory reference `LoopRuntimePort`) so every
 * test exercises core policy — routing, validation retry, approval
 * protocol, steering — with zero SDK involvement.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod";
import { loopRuntimeAdapter } from "../../adapter/define-executor";
import { fakeLoopRuntime } from "../../adapter/testing";
import { prompt as makePrompt } from "../../prompt/prompt";
import { fallback } from "../../generation/fallback";
import { ValidationExhaustedError } from "../../generation/validation-retry";
import { appendToolApprovalResponse } from "../../tools/approvals";
import { resetHooks } from "../../runtime/runtime";
import { boundary, guardrail, SafetyStructuredSyncError } from "../../safety";
import type { Message } from "../../generation/messages";
import type {
  StepDirective,
  StructuredRequest,
} from "../../adapter/executor-types";

afterEach(() => {
  resetHooks();
});

function textPrompt() {
  return makePrompt({
    id: "exec-text",
    system: "You are concise.",
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
  });
}

function structuredPrompt() {
  return makePrompt({
    id: "exec-structured",
    system: "Return JSON.",
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  });
}

function waitForAbort(signal: AbortSignal | undefined): Promise<void> {
  if (!signal)
    return Promise.reject(new Error("expected a step timeout signal"));
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}

describe("loopRuntimeAdapter — text generation", () => {
  it("resolves the prompt, maps settings, and returns the loop outcome", async () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "hello world" }]] });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(textPrompt(), {
      model: "fake:m-1",
      input: { instruction: "Say hello" },
    });

    expect(result.text).toBe("hello world");
    expect(result.steps).toBe(1);
    expect(result._meta.finishReason).toBe("stop");
    expect(result.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "hello world",
    });

    const request = fake.calls.runTextLoop[0]!;
    expect(request.modelInfo).toEqual({ provider: "fake", modelId: "m-1" });
    expect(request.system).toBe("You are concise.");
    expect(request.prompt).toBe("Say hello");
    expect(request.maxSteps).toBe(10);
  });

  it("runs the tool loop and surfaces tool rounds in canonical messages", async () => {
    const lookup = vi.fn(async (args: unknown) => ({
      found: (args as { q: string }).q,
    }));
    const fake = fakeLoopRuntime({
      loops: [
        [
          { text: "", toolCalls: [{ name: "lookup", args: { q: "x" } }] },
          { text: "answer" },
        ],
      ],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(textPrompt(), {
      model: "fake:m-1",
      input: { instruction: "Find x" },
      tools: { lookup: { description: "lookup", execute: lookup } },
    });

    expect(lookup).toHaveBeenCalledWith(
      { q: "x" },
      expect.objectContaining({ toolCallId: expect.any(String) }),
    );
    expect(result.text).toBe("answer");
    expect(result.steps).toBe(2);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("lets a caller observer stop the loop after a step", async () => {
    const fake = fakeLoopRuntime({
      loops: [
        [
          { text: "step one", toolCalls: [{ name: "noop", args: {} }] },
          { text: "never reached", toolCalls: [{ name: "noop", args: {} }] },
          { text: "never reached either" },
        ],
      ],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const directives: StepDirective[] = [{ kind: "stop", reason: "enough" }];
    const result = await executor.generate(textPrompt(), {
      model: "fake:m-1",
      input: { instruction: "go" },
      tools: { noop: { execute: async () => "ok" } },
      observer: {
        onStepEnd: async () => directives.shift() ?? { kind: "continue" },
      },
    });

    expect(result.steps).toBe(1);
    expect(result.text).toBe("step one");
  });
});

describe("loopRuntimeAdapter — structured output + validation retry", () => {
  it("returns the parsed object on a valid first attempt", async () => {
    const fake = fakeLoopRuntime({ structured: ['{"title":"hi","count":2}'] });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(structuredPrompt(), {
      model: "fake:m-1",
      input: { instruction: "make json" },
    });

    expect(result.object).toEqual({ title: "hi", count: 2 });
    expect(result.steps).toBe(1);
    expect(fake.calls.runStructuredAttempt).toHaveLength(1);
  });

  it("returns the synchronized object when output safety rewrites structured text", async () => {
    const fake = fakeLoopRuntime({
      structured: ['{"title":"private","count":2}'],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(structuredPrompt(), {
      model: "fake:m-1",
      input: { instruction: "make json" },
      guardrails: [
        guardrail({
          id: "redact-title",
          on: boundary.output.text(),
          run: (text) => ({
            action: "rewrite",
            value: text.replace("private", "[redacted]"),
            rewrite: { kind: "redact" },
          }),
        }),
      ],
    });

    expect(result.text).toBe('{"title":"[redacted]","count":2}');
    expect(result.object).toEqual({ title: "[redacted]", count: 2 });
  });

  it("fails closed with the rewriting policy id when structured safety violates the schema", async () => {
    const fake = fakeLoopRuntime({
      structured: ['{"title":"private","count":2}'],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const error = await executor
      .generate(structuredPrompt(), {
        model: "fake:m-1",
        input: { instruction: "make json" },
        guardrails: [
          guardrail({
            id: "break-count",
            on: boundary.output.text(),
            run: (text) => ({
              action: "rewrite",
              value: text.replace('"count":2', '"count":"two"'),
              rewrite: { kind: "normalize" },
            }),
          }),
        ],
      })
      .then(() => undefined)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SafetyStructuredSyncError);
    expect(error).toMatchObject({ policyId: "break-count" });
  });

  it("retries with corrective feedback on invalid output, then succeeds", async () => {
    const onRetry = vi.fn();
    const fake = fakeLoopRuntime({
      structured: ['{"title":"hi","count":"two"}', '{"title":"hi","count":2}'],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(structuredPrompt(), {
      model: "fake:m-1",
      input: { instruction: "make json" },
      validationRetry: { maxRetries: 2, onRetry },
    });

    expect(result.object).toEqual({ title: "hi", count: 2 });
    expect(result.steps).toBe(2);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The retry attempt carries the failed output and corrective feedback.
    const retryRequest = fake.calls.runStructuredAttempt[1]!;
    const contents = (retryRequest.messages ?? []).map((m) => m.content);
    expect(
      contents.some(
        (c) => typeof c === "string" && c.includes('"count":"two"'),
      ),
    ).toBe(true);
    expect(
      contents.some(
        (c) => typeof c === "string" && c.includes("Validation failed"),
      ),
    ).toBe(true);
  });

  it("gives each structured validation retry a fresh step timeout signal", async () => {
    vi.useFakeTimers();
    const fake = fakeLoopRuntime({
      structured: ['{"title":"hi","count":"two"}', '{"title":"hi","count":2}'],
    });
    const calls: StructuredRequest<string>[] = [];
    const runtime = {
      ...fake.runtime,
      async runStructuredAttempt(request: StructuredRequest<string>) {
        calls.push(request);
        if (calls.length === 1) {
          await waitForAbort(request.abortSignal);
        } else if (request.abortSignal?.aborted) {
          throw new Error("retry inherited an aborted step signal");
        }
        return fake.runtime.runStructuredAttempt(request);
      },
    };
    const executor = loopRuntimeAdapter(runtime);

    const resultPromise = executor.generate(structuredPrompt(), {
      model: "fake:m-1",
      input: { instruction: "make json" },
      timeout: { stepMs: 20 },
      validationRetry: { maxRetries: 1 },
    });

    try {
      await vi.advanceTimersByTimeAsync(20);
      const result = await resultPromise;

      expect(result.object).toEqual({ title: "hi", count: 2 });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.abortSignal).not.toBe(calls[1]!.abortSignal);
      expect(calls[1]!.abortSignal?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws ValidationExhaustedError when retries run out", async () => {
    const onExhausted = vi.fn();
    const fake = fakeLoopRuntime({
      structured: ["not json", "still not json"],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    await expect(
      executor.generate(structuredPrompt(), {
        model: "fake:m-1",
        input: { instruction: "make json" },
        validationRetry: { maxRetries: 1, onExhausted },
      }),
    ).rejects.toThrow(ValidationExhaustedError);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(fake.calls.runStructuredAttempt).toHaveLength(2);
  });
});

describe("loopRuntimeAdapter — routing dispatch", () => {
  it("falls back to the next model when the first attempt throws a retryable error", async () => {
    const rateLimited = Object.assign(new Error("rate limited"), {
      status: 429,
    });
    const fake = fakeLoopRuntime({
      loops: [rateLimited, [{ text: "from backup" }]],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(textPrompt(), {
      model: fallback("fake:primary", "fake:backup"),
      input: { instruction: "go" },
    });

    expect(result.text).toBe("from backup");
    expect(fake.calls.runTextLoop).toHaveLength(2);
    expect(fake.calls.runTextLoop[0]!.modelInfo.modelId).toBe("primary");
    expect(fake.calls.runTextLoop[1]!.modelInfo.modelId).toBe("backup");
    expect(result.routing?.trace).toMatchObject([
      {
        kind: "fallback",
        attempts: [
          { model: "primary", status: "error" },
          { model: "backup", status: "ok" },
        ],
      },
    ]);
  });

  it("applies timeout.totalMs once across three hanging fallback attempts", async () => {
    const fake = fakeLoopRuntime();
    const runtime = {
      ...fake.runtime,
      async runTextLoop(
        request: Parameters<typeof fake.runtime.runTextLoop>[0],
      ) {
        fake.calls.runTextLoop.push(request);
        if (request.abortSignal?.aborted) {
          throw request.abortSignal.reason ?? new Error("aborted");
        }
        return new Promise<never>((_, reject) => {
          request.abortSignal?.addEventListener(
            "abort",
            () => reject(request.abortSignal?.reason ?? new Error("aborted")),
            { once: true },
          );
        });
      },
    };
    const executor = loopRuntimeAdapter(runtime);
    const start = Date.now();

    const result = executor.generate(textPrompt(), {
      model: fallback("fake:a", "fake:b", "fake:c", { timeout: 200 }),
      input: { instruction: "go" },
      timeout: { totalMs: 300 },
    });

    await expect(result).rejects.toMatchObject({
      name: "FallbackExhaustedError",
    });
    expect(Date.now() - start).toBeLessThan(450);
    expect(
      fake.calls.runTextLoop.map((request) => request.modelInfo.modelId),
    ).toEqual(["a", "b"]);
  });
});

describe("loopRuntimeAdapter — tool approval protocol", () => {
  const dangerousTools = (execute: ReturnType<typeof vi.fn>) => ({
    dangerous: { description: "risky", execute },
  });
  const dangerousApproval = { dangerous: "always" } as const;

  it("suspends on approval-gated tools with a minted token and request message", async () => {
    const execute = vi.fn();
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "I need approval",
            toolCalls: [{ name: "dangerous", args: { target: "db" } }],
          },
        ],
      ],
    });
    const executor = loopRuntimeAdapter(fake.runtime);

    const result = await executor.generate(textPrompt(), {
      model: "fake:m-1",
      input: { instruction: "do it" },
      tools: dangerousTools(execute),
      toolApproval: dangerousApproval,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result._meta.finishReason).toBe("tool_approval_required");
    expect(result.pendingApprovals).toHaveLength(1);
    const approval = result.pendingApprovals![0]!;
    expect(approval.toolName).toBe("dangerous");
    expect(approval.approvalId).toBe(`approval_${approval.toolCallId}`);
    expect(approval.approvalToken.length).toBeGreaterThan(0);

    const lastMessage = result.messages.at(-1)!;
    expect(
      (lastMessage.metadata as { toolApprovalRequests?: unknown[] } | undefined)
        ?.toolApprovalRequests,
    ).toHaveLength(1);
  });

  it("resumes an approved tool call: executes it and feeds the round back to the loop", async () => {
    const execute = vi.fn(async () => "deleted 3 rows");
    const fake = fakeLoopRuntime({
      loops: [
        [
          {
            text: "I need approval",
            toolCalls: [{ name: "dangerous", args: { target: "db" } }],
          },
        ],
        [{ text: "all done" }],
      ],
    });
    const executor = loopRuntimeAdapter(fake.runtime);
    const prompt = textPrompt();
    const tools = dangerousTools(execute);

    const suspended = await executor.generate(prompt, {
      model: "fake:m-1",
      input: { instruction: "do it" },
      tools,
      toolApproval: dangerousApproval,
    });
    const approval = suspended.pendingApprovals![0]!;

    const resumeMessages = appendToolApprovalResponse(suspended.messages, {
      approvalId: approval.approvalId,
      approved: true,
      approvalToken: approval.approvalToken,
    }) as Message[];

    const resumed = await executor.generate(prompt, {
      model: "fake:m-1",
      input: { instruction: "do it" },
      tools,
      toolApproval: dangerousApproval,
      messages: resumeMessages,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(resumed.text).toBe("all done");
    // The replayed tool round reached the second loop call.
    const secondLoopMessages = fake.calls.runTextLoop[1]!.messages ?? [];
    expect(
      secondLoopMessages.some(
        (m) => m.role === "tool" && m.content.includes("deleted 3 rows"),
      ),
    ).toBe(true);
  });
});

describe("loopRuntimeAdapter — streaming", () => {
  it("returns the raw SDK stream plus typed completion metadata", async () => {
    const fake = fakeLoopRuntime({ streams: [["hel", "lo"]] });
    const executor = loopRuntimeAdapter(fake.runtime);

    const handle = await executor.stream(textPrompt(), {
      model: "fake:m-1",
      input: { instruction: "stream it" },
    });

    expect(handle.raw).toMatchObject({ kind: "fake-stream" });
    const meta = await handle.completion();
    expect(meta?.text).toBe("hello");
    expect(meta?.streaming?.totalChunks).toBe(2);
  });

  it("cleans up timeout timers when stream setup fails before a handle is returned", async () => {
    const fake = fakeLoopRuntime();
    const setupError = new Error("stream setup failed");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const executor = loopRuntimeAdapter({
      ...fake.runtime,
      async runStream(request) {
        fake.calls.runStream.push(request);
        throw setupError;
      },
    });

    try {
      await expect(
        executor.stream(textPrompt(), {
          model: "fake:m-1",
          input: { instruction: "stream it" },
          timeout: { stepMs: 1_000 },
        }),
      ).rejects.toThrow(setupError);
      expect(clearTimeoutSpy).toHaveBeenCalled();
    } finally {
      clearTimeoutSpy.mockRestore();
    }
  });
});
