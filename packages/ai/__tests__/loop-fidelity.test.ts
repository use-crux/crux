/**
 * Loop-fidelity tests: `MockLanguageModelV3` through the REAL `generateText`
 * / `generateObject` via the live gateway. These prove the executor's
 * neutral `stopWhen`/directive buffering, tier-1 repair, and tool approval
 * suspension hold against actual SDK loop mechanics — the seams a scripted
 * gateway cannot exercise.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { maxSteps, prompt as makePrompt, tool } from "@use-crux/core";
import { createCruxAi } from "../src";
import {
  emissionModel as mockModel,
  capturingEmissionModel,
} from "./mock-model";

const textPrompt = makePrompt({
  id: "fidelity-text",
  system: "You are terse.",
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
});

const objectPrompt = makePrompt({
  id: "fidelity-object",
  system: "Return JSON.",
  prompt: ({ input }) => (input as { message: string }).message,
  input: z.object({ message: z.string() }),
  output: z.object({ title: z.string(), count: z.number() }),
});

describe("loop fidelity — real generateText", () => {
  it("installs a Tool returned by prepareStep before the first SDK call", async () => {
    const execute = vi.fn(async () => "found it");
    const lookup = tool({
      description: "lookup",
      input: z.object({ q: z.number() }),
      execute,
    });
    const ai = createCruxAi();
    const model = mockModel([
      { toolCalls: [{ name: "lookup", args: { q: 1 } }] },
      { text: "answer after preparation" },
    ]);
    const snapshots: unknown[] = [];
    const prepareStep = vi.fn(
      (context: {
        index: number;
        stats: { run: unknown };
      }) => {
        snapshots.push(context.stats.run);
        return context.index === 0
          ? { tools: { lookup }, activeTools: ["lookup"] }
          : undefined;
      },
    );

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      maxSteps: 2,
      prepareStep,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(prepareStep).toHaveBeenCalledTimes(2);
    expect(snapshots[1]).toMatchObject({
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        coverage: { tokens: "complete", cost: "none" },
      },
      modelCalls: { started: 1, succeeded: 1 },
    });
    expect(result.text).toBe("answer after preparation");
  });

  it("installs a later Tool definition before the next SDK call", async () => {
    const execute = vi.fn(async () => "seed result");
    const executeLater = vi.fn(async () => "later result");
    const later = tool({
      description: "later",
      input: z.object({}),
      execute: executeLater,
    });
    const ai = createCruxAi();
    const model = mockModel([
      { toolCalls: [{ name: "seed", args: { q: 1 } }] },
      { toolCalls: [{ name: "later", args: {} }] },
      { text: "done" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      maxSteps: 3,
      tools: {
        seed: {
          description: "seed",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
      prepareStep: ({ index }) =>
        index === 1 ? { tools: { later }, activeTools: ["later"] } : undefined,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(executeLater).toHaveBeenCalledOnce();
    expect(result.text).toBe("done");
  });

  it("loops tool rounds by default, matching every other Crux adapter", async () => {
    const execute = vi.fn(async () => "tool ran");
    const ai = createCruxAi();
    const model = mockModel([
      { text: "", toolCalls: [{ name: "lookup", args: { q: 1 } }] },
      { text: "answer after the tool round" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
    });

    // Cross-adapter parity: the default budget (maxSteps 10) lets the loop
    // continue past the tool round, exactly like @use-crux/openai et al.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("answer after the tool round");
    expect(
      (result as unknown as { _meta: { finishReason: string } })._meta
        .finishReason,
    ).toBe("stop");
  });

  it("restores single-step behavior with maxSteps: 1", async () => {
    const execute = vi.fn(async () => "tool ran");
    const ai = createCruxAi();
    const model = mockModel([
      { text: "", toolCalls: [{ name: "lookup", args: { q: 1 } }] },
      { text: "should not be reached" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
      maxSteps: 1,
    });

    // One step: the tool executed, but no second model call happened.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("");
    expect(
      (result as unknown as { _meta: { finishReason: string } })._meta
        .finishReason,
    ).toBe("tool-calls");
  });

  it("loops through tool rounds when stopWhen allows it", async () => {
    const execute = vi.fn(async () => "found it");
    const ai = createCruxAi();
    const model = mockModel([
      { text: "", toolCalls: [{ name: "lookup", args: { q: 1 } }] },
      { text: "answer after tools" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
      stopWhen: maxSteps(3),
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("answer after tools");
  });

  it("suspends on toolApproval without executing the tool", async () => {
    const execute = vi.fn(async () => "dangerous result");
    const ai = createCruxAi();
    const model = mockModel([
      {
        text: "requesting approval",
        toolCalls: [{ name: "guarded", args: { go: true } }],
      },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        guarded: {
          description: "guarded",
          inputSchema: z.object({ go: z.boolean() }),
          execute,
        },
      } as never,
      toolApproval: { guarded: "always" },
    });

    expect(execute).not.toHaveBeenCalled();
    const suspended = result as unknown as {
      _meta: { finishReason: string };
      pendingApprovals?: Array<{ toolName: string; approvalToken: string }>;
    };
    expect(suspended._meta.finishReason).toBe("tool_approval_required");
    expect(suspended.pendingApprovals).toHaveLength(1);
    expect(suspended.pendingApprovals![0]!.toolName).toBe("guarded");
    expect(
      suspended.pendingApprovals![0]!.approvalToken.length,
    ).toBeGreaterThan(0);
  });
});

describe("loop fidelity — tool-call repair (cross-adapter parity)", () => {
  it("survives a hallucinated tool name: error result fed back, loop recovers", async () => {
    const execute = vi.fn(async () => "real result");
    const ai = createCruxAi();
    const { model, prompts } = capturingEmissionModel([
      { text: "", toolCalls: [{ name: "ghost", args: { q: 1 } }] },
      { text: "recovered after the error" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
    });

    // No NoSuchToolError escaped; the loop continued and recovered.
    expect(result.text).toBe("recovered after the error");
    expect(execute).not.toHaveBeenCalled();

    // The model saw core's exact error phrasing as a tool result.
    const secondPrompt = JSON.stringify(prompts[1]);
    expect(secondPrompt).toContain('Tool \\"ghost\\" not found');
    // The internal reporter was never advertised to the provider.
    expect(JSON.stringify(prompts[0])).not.toContain("__crux_tool_error__");
  });

  it("survives invalid tool input: validation error fed back, loop recovers", async () => {
    const execute = vi.fn(async () => "real result");
    const ai = createCruxAi();
    const { model, prompts } = capturingEmissionModel([
      // q must be a number — the model sends a string.
      { text: "", toolCalls: [{ name: "lookup", args: { q: "one" } }] },
      { text: "fixed it" },
    ]);

    const result = await ai.generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ q: z.number() }),
          execute,
        },
      } as never,
    });

    expect(result.text).toBe("fixed it");
    // The bad input never reached the tool.
    expect(execute).not.toHaveBeenCalled();
    // The model received a corrective error result mentioning the tool.
    const secondPrompt = JSON.stringify(prompts[1]);
    expect(secondPrompt).toContain("error");
    expect(secondPrompt).toContain("lookup");
  });
});

describe("loop fidelity — tier-1 repair via real generateObject", () => {
  it("repairs markdown-fenced JSON without charging a retry", async () => {
    const ai = createCruxAi();
    const model = mockModel([
      { text: '```json\n{"title":"fenced","count":7}\n```' },
    ]);

    const result = await ai.generate(objectPrompt, {
      model,
      input: { message: "json please" },
      // No validationRetry configured — repair alone must save this.
    });

    expect(result.object).toEqual({ title: "fenced", count: 7 });
  });
});
