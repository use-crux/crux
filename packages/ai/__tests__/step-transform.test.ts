/** Pre-client-tool language step Safety through the live AI SDK gateway. */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { boundary, constraint, guardrail } from "@use-crux/core/safety";
import { createCruxAi } from "../src";
import { capturingEmissionModel } from "./mock-model";

const textPrompt = prompt({
  id: "ai-sdk-step-transform",
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
});

const objectPrompt = prompt({
  id: "ai-sdk-structured-step-transform",
  prompt: ({ input }) => input.message,
  input: z.object({ message: z.string() }),
  output: z.object({ value: z.string() }),
});

describe("AI SDK step transform", () => {
  it("blocks in model middleware before client tools, observation, or continuation", async () => {
    const execute = vi.fn(async () => "tool result");
    const seen: string[] = [];
    const { model, prompts } = capturingEmissionModel([
      {
        text: "unsafe intermediate",
        toolCalls: [{ id: "call-1", name: "lookup", args: { query: "x" } }],
      },
      { text: "must not continue" },
    ]);

    await expect(
      createCruxAi().generate(textPrompt, {
        model,
        input: { message: "go" },
        tools: {
          lookup: {
            description: "lookup",
            inputSchema: z.object({ query: z.string() }),
            execute,
          },
        },
        guardrails: [
          guardrail({
            id: "block-ai-sdk-intermediate",
            on: boundary.output.text(),
            run: (text) => {
              seen.push(text);
              return { action: "block", reason: "unsafe" };
            },
          }),
        ],
      }),
    ).rejects.toThrow("block-ai-sdk-intermediate");

    expect(seen).toEqual(["unsafe intermediate"]);
    expect(prompts).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("guards structured provider text once before AI SDK parsing", async () => {
    const seen: string[] = [];
    const { model } = capturingEmissionModel([{ text: '{"value":"unsafe"}' }]);

    const result = await createCruxAi().generate(objectPrompt, {
      model,
      input: { message: "return JSON" },
      guardrails: [
        guardrail({
          id: "rewrite-ai-sdk-structured-step",
          on: boundary.output.text(),
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: text.replace("unsafe", "safe"),
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    });

    expect(seen).toEqual(['{"value":"unsafe"}']);
    expect(result.text).toBe('{"value":"safe"}');
    expect(result.object).toEqual({ value: "safe" });
    expect(result.steps[0]?.text).toBe('{"value":"safe"}');
  });

  it("preserves reasoning and media when structured text is cheaply repaired", async () => {
    const reasoning = { type: "reasoning" as const, text: "considering" };
    const image = {
      type: "file" as const,
      mediaType: "image/png",
      data: "aW1hZ2U=",
    };
    const { model } = capturingEmissionModel([
      {
        content: [
          reasoning,
          image,
          { type: "text", text: '{"value":"safe",}' },
        ],
      },
    ]);

    const result = await createCruxAi().generate(objectPrompt, {
      model,
      input: { message: "return JSON" },
      guardrails: [
        guardrail({
          id: "allow-repaired-structured-parts",
          on: boundary.output.text(),
          run: () => ({ action: "allow" }),
        }),
      ],
    });

    expect(result.object).toEqual({ value: "safe" });
    expect(
      (result.raw as unknown as { readonly text?: string } | undefined)?.text,
    ).toBe('{"value":"safe",}');
    expect(result.text).toBe('{"value":"safe"}');
    expect(result.steps[0]?.content.map((part) => part.type)).toEqual([
      "reasoning",
      "image",
      "text",
    ]);
    expect(result.steps[0]?.content[0]).toMatchObject(reasoning);
    expect(result.steps[0]?.content[1]).toMatchObject({
      type: "image",
      mediaType: "image/png",
    });
    expect(result.steps[0]?.content[2]).toEqual({
      type: "text",
      text: '{"value":"safe"}',
    });
  });

  it("guards every live structured validation attempt with monotonic steps", async () => {
    const seen: string[] = [];
    const { model } = capturingEmissionModel([
      { text: '{"value":1}' },
      { text: '{"value":"unsafe"}' },
    ]);

    const result = await createCruxAi().generate(objectPrompt, {
      model,
      input: { message: "return JSON" },
      validationRetry: { maxRetries: 1 },
      guardrails: [
        guardrail({
          id: "rewrite-ai-sdk-structured-retry",
          on: boundary.output.text(),
          run: (text, ctx) => {
            seen.push(`${ctx.attempt.index}:${text}`);
            return text.includes("unsafe")
              ? {
                  action: "rewrite",
                  value: text.replace("unsafe", "safe"),
                  rewrite: { kind: "normalize" },
                }
              : { action: "allow" };
          },
        }),
      ],
    });

    expect(seen).toEqual(['0:{"value":1}', '0:{"value":"unsafe"}']);
    expect(result.steps.map((step) => step.text)).toEqual([
      "",
      '{"value":"safe"}',
    ]);
    expect(result.object).toEqual({ value: "safe" });
  });

  it("rejects schema-invalid constraint regeneration before rechecking constraints", async () => {
    const stepSeen: string[] = [];
    const constraintSeen: string[] = [];
    const { model, prompts } = capturingEmissionModel([
      { text: '{"value":"draft"}' },
      { text: "ship but not JSON" },
    ]);

    await expect(
      createCruxAi().generate(objectPrompt, {
        model,
        input: { message: "return JSON" },
        validationRetry: { maxRetries: 0 },
        constraints: [
          constraint({
            id: "ai-sdk-structured-regeneration-ship",
            on: boundary.output.text(),
            maxRetries: 1,
            run: (text) => {
              constraintSeen.push(text);
              return text.includes("ship")
                ? { pass: true }
                : { pass: false, feedback: "mention ship" };
            },
          }),
        ],
        guardrails: [
          guardrail({
            id: "observe-ai-sdk-structured-regeneration",
            on: boundary.output.text(),
            run: (text) => {
              stepSeen.push(text);
              return { action: "allow" };
            },
          }),
        ],
      }),
    ).rejects.toMatchObject({ name: "ValidationExhaustedError" });

    expect(stepSeen).toEqual(['{"value":"draft"}', "ship but not JSON"]);
    expect(constraintSeen).toEqual(['{"value":"draft"}']);
    expect(prompts).toHaveLength(2);
  });

  it("guards provider-executed server-tool output before local exposure or continuation", async () => {
    const clientExecute = vi.fn(async () => "must not run");
    const seen: string[] = [];
    const { model } = capturingEmissionModel([
      {
        content: [
          { type: "text", text: "unsafe remote result" },
          {
            type: "tool-call",
            toolCallId: "remote-call-1",
            toolName: "lookup",
            input: '{"query":"x"}',
            providerExecuted: true,
          },
          {
            type: "tool-result",
            toolCallId: "remote-call-1",
            toolName: "lookup",
            result: { answer: "provider already ran this" },
          },
        ],
      },
      { text: "done" },
    ]);

    const result = await createCruxAi().generate(textPrompt, {
      model,
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          inputSchema: z.object({ query: z.string() }),
          execute: clientExecute,
        },
      },
      guardrails: [
        guardrail({
          id: "rewrite-provider-server-tool-text",
          on: boundary.output.text(),
          run: (text) => {
            seen.push(text);
            return text.startsWith("unsafe")
              ? {
                  action: "rewrite",
                  value: text.replace("unsafe", "safe"),
                  rewrite: { kind: "normalize" },
                }
              : { action: "allow" };
          },
        }),
      ],
    });

    expect(clientExecute).not.toHaveBeenCalled();
    expect(seen).toEqual(["unsafe remote result"]);
    expect(result.steps[0]?.text).toBe("safe remote result");
    expect(
      result.steps[0]?.content.some((part) => part.type === "tool-call"),
    ).toBe(true);
    expect(result.finalStep.text).toBe("safe remote result");
  });
});
