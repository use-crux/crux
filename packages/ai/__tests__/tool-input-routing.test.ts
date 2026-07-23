/**
 * SDK-regime tool-argument routing.
 *
 * Core owns tool-argument compilation and the sole authored parse. The AI SDK
 * receives only the compiled wire schema as each tool's `inputSchema` and never
 * runs the authored Zod validator; the wrapped `execute` decodes the model's
 * arguments, runs the authored schema exactly once, and executes on the parsed
 * value. Invalid arguments become a model-visible tool error instead of failing
 * the whole generation.
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { createCruxAi } from "../src";
import { capturingEmissionModel } from "./mock-model";

const toolPrompt = prompt({
  id: "ai-sdk-tool-input-routing",
  prompt: "Use the tool.",
});

describe("AI SDK tool-argument routing", () => {
  it("executes on the authored-parsed value, applying transforms exactly once", async () => {
    let received: unknown;
    const { model } = capturingEmissionModel([
      {
        toolCalls: [
          { id: "call-1", name: "measure", args: { value: "hello" } },
        ],
      },
      { text: "done" },
    ]);

    await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        measure: {
          description: "measure",
          // z.input is `{ value: string }`; z.output is `{ value: number }`.
          // If the SDK ran the authored Zod, the wrapped execute would parse the
          // already-transformed number a second time and fail. It succeeds only
          // because the SDK validated the wire (pre-transform) schema.
          inputSchema: z.object({
            value: z.string().transform((v) => v.length),
          }),
          execute: async (input: unknown) => {
            received = input;
            return { ok: true };
          },
        },
      },
    });

    expect(received).toEqual({ value: 5 });
  });

  it("surfaces a model-visible tool error for arguments only the authored schema rejects", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const { model, prompts } = capturingEmissionModel([
      {
        toolCalls: [
          { id: "call-1", name: "restricted", args: { value: "nope" } },
        ],
      },
      { text: "acknowledged" },
    ]);

    // A `.refine()` cannot be expressed in the JSON wire schema, so the SDK
    // accepts the argument structurally and core is the one that rejects it.
    const result = await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        restricted: {
          description: "restricted",
          inputSchema: z.object({
            value: z.string().refine((v) => v.startsWith("x"), {
              message: "must start with x",
            }),
          }),
          execute,
        },
      },
    });

    // The authored tool never ran, generation completed, and the model saw a
    // sanitized tool error naming the failing field by its schema path.
    expect(execute).not.toHaveBeenCalled();
    expect(result.text).toBe("acknowledged");
    const lastPrompt = prompts.at(-1) as ReadonlyArray<{
      readonly role: string;
      readonly content: unknown;
    }>;
    const toolResult = JSON.stringify(
      lastPrompt.filter((message) => message.role === "tool"),
    );
    // A safe schema path is retained; the developer's custom `.refine` message
    // (which could echo the value) and the raw argument are both suppressed.
    expect(toolResult).toContain("value");
    expect(toolResult).not.toContain("must start with x");
    expect(toolResult).not.toContain("nope");
  });
});
