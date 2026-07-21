/** Canonical media and mixed-content tool ingress through the public Core adapter. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import { toolIngressPrompt as textPrompt, toolIngressScript as coreStepScript } from "./tool-ingress.fixture";

describe("Core media tool ingress", () => {
  it("fails closed when a tool text rewrite changes a protected media descriptor", async () => {
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-protected", name: "lookup", args: {} }],
      },
      { text: "must not continue" },
    ]);

    await expect(
      adapter(scripted.spec)(scripted.client).generate(textPrompt(), {
        model: "test-model",
        input: { message: "go" },
        tools: {
          lookup: {
            description: "lookup",
            execute: async () => "raw",
            toModelOutput: () => ({
              type: "content" as const,
              value: [
                { type: "text" as const, text: "caption" },
                {
                  type: "image" as const,
                  source: new Uint8Array([1, 2, 3]),
                  mediaType: "image/png",
                },
              ],
            }),
          },
        },
        guardrails: [
          guardrail({
            id: "mutate-tool-descriptor",
            on: boundary.input.text({ from: "tool" }),
            run: (text) => ({
              action: "rewrite",
              value: text.replace("[image", "[file"),
              rewrite: { kind: "redact" },
            }),
          }),
        ],
      }),
    ).rejects.toThrow(/no longer aligns with its media placeholders/);

    expect(scripted.calls).toBe(1);
  });

  it("strips tool media before rewriting the retained bounded text projection", async () => {
    const textSeen: string[] = [];
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-mixed", name: "lookup", args: { query: "x" } }],
      },
      { text: "done" },
    ]);

    await adapter(scripted.spec)(scripted.client).generate(textPrompt(), {
      model: "test-model",
      input: { message: "go" },
      tools: {
        lookup: {
          description: "lookup",
          execute: async () => "raw",
          toModelOutput: () => ({
            type: "content" as const,
            value: [
              { type: "text" as const, text: "private summary" },
              {
                type: "image" as const,
                source: new Uint8Array([1, 2, 3]),
                mediaType: "image/png",
              },
            ],
          }),
        },
      },
      guardrails: [
        guardrail({
          id: "strip-tool-image",
          on: boundary.input.media({ from: "tool" }),
          run: () => ({ action: "strip", reason: "remove image" }),
        }),
        guardrail({
          id: "rewrite-tool-summary",
          on: boundary.input.text({ from: "tool" }),
          run: (text) => {
            textSeen.push(text);
            return {
              action: "rewrite",
              value: "safe summary",
              rewrite: { kind: "redact" },
            };
          },
        }),
      ],
    });

    expect(textSeen).toEqual(["private summary"]);
    expect(scripted.providerMessages[1]).toContainEqual({
      role: "tool",
      content: "safe summary",
      metadata: { toolCallId: "call-mixed", toolName: "lookup" },
    });
  });

  it("blocks media introduced by custom tool model output before the next provider call", async () => {
    const scripted = coreStepScript([
      {
        text: "",
        toolCalls: [{ id: "call-image", name: "lookup", args: { query: "x" } }],
      },
      { text: "must not continue" },
    ]);
    const runtime = adapter(scripted.spec)(scripted.client);

    await expect(
      runtime.generate(textPrompt(), {
        model: "test-model",
        input: { message: "go" },
        tools: {
          lookup: {
            description: "lookup",
            execute: async () => ({ safe: true }),
            toModelOutput: () => ({
              type: "content" as const,
              value: [
                {
                  type: "image" as const,
                  source: new Uint8Array([1, 2, 3]),
                  mediaType: "image/png",
                },
              ],
            }),
          },
        },
        guardrails: [
          guardrail({
            id: "block-tool-image",
            on: boundary.input.media({ from: "tool" }),
            run: (_subject, context) => {
              expect(context.origin).toEqual({
                source: "tool",
                kind: "tool-result",
                toolName: "lookup",
                toolCallId: "call-image",
                partIndex: 0,
              });
              return { action: "block", reason: "unsafe tool image" };
            },
          }),
        ],
      }),
    ).rejects.toBeInstanceOf(GuardrailBlockedError);

    expect(scripted.calls).toBe(1);
  });

});
