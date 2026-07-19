/** Per-step language output Safety through the public core adapter. */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type { AdapterResponse } from "../../src/adapter/types";
import type { AssistantContentPart } from "../../src/types/content";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import { skill } from "../../src/skill";
import { LOAD_SKILL_TOOL_NAME } from "../../src/skill/tools";

describe("language step Safety — core continuation", () => {
  it("blocks intermediate text before its client tool or the next model call", async () => {
    const execute = vi.fn(async () => "tool result");
    const scripted = coreStepScript([
      {
        text: "unsafe intermediate",
        toolCalls: [{ id: "call-1", name: "lookup", args: { query: "x" } }],
      },
      { text: "must not continue" },
    ]);
    const runtime = adapter(scripted.spec)(scripted.client);

    await expect(
      runtime.generate(textPrompt(), {
        model: "test-model",
        input: { message: "go" },
        tools: { lookup: { description: "lookup", execute } },
        guardrails: [
          guardrail({
            id: "block-intermediate-text",
            on: boundary.output.text(),
            run: () => ({ action: "block", reason: "unsafe" }),
          }),
        ],
      }),
    ).rejects.toThrow("block-intermediate-text");

    expect(execute).not.toHaveBeenCalled();
    expect(scripted.calls).toBe(1);
  });

  it("rewrites reasoning/text, strips media, and preserves tool and provider facts in a two-step envelope", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    const toolCall = Object.freeze({
      type: "tool-call" as const,
      toolCallId: "call-rich",
      toolName: "lookup",
      input: { query: "x" },
    });
    const warning = Object.freeze({ code: "provider-warning" });
    const providerMetadata = Object.freeze({ provider: "metadata" });
    const textSeen: string[] = [];
    const mediaOrigins: unknown[] = [];
    const scripted = coreStepScript([
      {
        text: "unsafe visible",
        content: [
          { type: "reasoning", text: "unsafe reasoning" },
          image,
          { type: "text", text: "unsafe visible" },
          toolCall,
        ],
        toolCalls: [{ id: "call-rich", name: "lookup", args: { query: "x" } }],
        warnings: [warning],
        providerMetadata,
      },
      { text: "done", content: [{ type: "text", text: "done" }] },
    ]);

    const result = await adapter(scripted.spec)(scripted.client).generate(
      textPrompt(),
      {
        model: "test-model",
        input: { message: "go" },
        tools: {
          lookup: { description: "lookup", execute: async () => "tool result" },
        },
        guardrails: [
          guardrail({
            id: "rewrite-rich-text",
            on: boundary.output.text(),
            run: (text) => {
              textSeen.push(text);
              return text.startsWith("unsafe")
                ? {
                    action: "rewrite",
                    value: text.replace("unsafe", "safe"),
                    rewrite: { kind: "normalize" },
                  }
                : { action: "allow" };
            },
          }),
          guardrail({
            id: "strip-rich-media",
            on: boundary.output.media(),
            run: (subject) => {
              mediaOrigins.push(subject.origin);
              return { action: "strip", reason: "remove media" };
            },
          }),
        ],
      },
    );

    expect(textSeen).toEqual(["unsafe reasoning", "unsafe visible", "done"]);
    expect(mediaOrigins).toEqual([
      { kind: "step", stepIndex: 0, partIndex: 1 },
    ]);
    expect(result.steps[0]?.content).toEqual([
      { type: "reasoning", text: "safe reasoning" },
      { type: "text", text: "safe visible" },
      toolCall,
    ]);
    expect(result.steps[0]?.content[2]).toBe(toolCall);
    expect(result.steps[0]?.warnings[0]).toBe(warning);
    expect(result.steps[0]?.providerMetadata).toBe(providerMetadata);
    expect(result.text).toBe("safe visibledone");
    expect(result.finalStep.text).toBe("done");
  });

  it("never reuses provider-response ordinals after a skill-load refund", async () => {
    const image = (byte: number) => ({
      type: "image" as const,
      source: new Uint8Array([byte]),
      mediaType: "image/png",
    });
    const loadCall = {
      type: "tool-call" as const,
      toolCallId: "load-ordinal",
      toolName: LOAD_SKILL_TOOL_NAME,
      input: { name: "ordinal" },
    };
    const scripted = coreStepScript([
      {
        text: "loading",
        content: [image(1), { type: "text", text: "loading" }, loadCall],
        toolCalls: [
          {
            id: "load-ordinal",
            name: LOAD_SKILL_TOOL_NAME,
            args: { name: "ordinal" },
          },
        ],
      },
      {
        text: "done",
        content: [image(2), { type: "text", text: "done" }],
      },
    ]);
    const origins: unknown[] = [];

    await adapter(scripted.spec)(scripted.client).generate(skillPrompt(), {
      model: "test-model",
      input: { message: "go" },
      maxSteps: 1,
      guardrails: [
        guardrail({
          id: "observe-refunded-media-origin",
          on: boundary.output.media(),
          run: (subject) => {
            origins.push(subject.origin);
            return { action: "allow" };
          },
        }),
      ],
    });

    expect(origins).toEqual([
      { kind: "step", stepIndex: 0, partIndex: 0 },
      { kind: "step", stepIndex: 1, partIndex: 0 },
    ]);
    expect(scripted.calls).toBe(2);
  });
});

function textPrompt() {
  return prompt({
    id: "language-step-core-output",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
  });
}

function skillPrompt() {
  return prompt({
    id: "language-step-refund-ordinal",
    prompt: ({ input }) => input.message,
    input: z.object({ message: z.string() }),
    use: [
      skill.inline({
        id: "ordinal",
        description: "Provider ordinal test skill",
        instructions: "Keep provider ordinals monotonic.",
      }),
    ],
  });
}

interface ScriptedStep {
  readonly text: string;
  readonly content?: readonly AssistantContentPart[];
  readonly toolCalls?: AdapterResponse["toolCalls"];
  readonly warnings?: readonly unknown[];
  readonly providerMetadata?: unknown;
}

function coreStepScript(steps: readonly ScriptedStep[]) {
  const queue = [...steps];
  let calls = 0;
  const client = { kind: "language-step-output" as const };
  const spec: AdapterSpec<typeof client, { readonly call: number }, never> = {
    providerId: "language-step-output",
    async call() {
      calls++;
      const next = queue.shift() ?? { text: "exhausted" };
      return {
        raw: { call: calls },
        extracted: response(next),
      };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages, assistant, results) {
      return [
        ...messages,
        {
          role: "assistant",
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: "tool" as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ];
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
  return {
    spec,
    client,
    get calls() {
      return calls;
    },
  };
}

function response(step: ScriptedStep): AdapterResponse {
  return {
    text: step.text,
    content: step.content,
    toolCalls: step.toolCalls,
    usage: undefined,
    finishReason: step.toolCalls?.length ? "tool_calls" : "stop",
    responseId: undefined,
    actualModelId: undefined,
    warnings: step.warnings,
    providerMetadata: step.providerMetadata,
  };
}
