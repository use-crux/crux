/**
 * End-to-end SDK-regime tool-argument decode failure via `createCruxAi().generate()`.
 *
 * When a real generation produces a tool call whose wire arguments cannot be
 * decoded against the tool's exact manifest, that single call fails closed: no
 * middleware, authored validation, or developer `execute` runs on it, and the
 * model receives a sanitized decode-error tool result. A valid sibling tool call
 * in the same step executes normally, and the generation continues to completion
 * on the next model step.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { prompt } from "@use-crux/core";
import { approvalMiddleware, toolMiddleware } from "@use-crux/core/adapter/tool";
import { createCruxAi } from "../src";
import { capturingEmissionModel } from "./mock-model";

const toolPrompt = prompt({
  id: "ai-sdk-tool-input-decode-e2e",
  prompt: "Use the tools.",
});

describe("AI SDK end-to-end tool decode failure", () => {
  it("fails one malformed call closed while a valid sibling executes and generation continues", async () => {
    const middlewareTools: string[] = [];
    const approvalTools: string[] = [];
    let saveParses = 0;
    let pingParses = 0;
    let saveExecuted = false;
    let pingInput: unknown;

    // OpenAI strict lowers the nested optional `note` to required+nullable and
    // records a delete-null-sentinel op at ["meta","note"]. A wire value whose
    // `meta` is a string cannot be traversed to that leaf, so decoding fails.
    const saveSchema = z
      .object({ meta: z.object({ note: z.string().optional() }) })
      .transform((value) => {
        saveParses += 1;
        return value;
      });
    const pingSchema = z.object({ q: z.string() }).transform((value) => {
      pingParses += 1;
      return value;
    });

    const { model, prompts } = capturingEmissionModel([
      {
        toolCalls: [
          { id: "s1", name: "save", args: { meta: "not-an-object" } },
          { id: "p1", name: "ping", args: { q: "hi" } },
        ],
      },
      { text: "done" },
    ]);

    const result = await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        save: {
          description: "save",
          inputSchema: saveSchema,
          execute: async () => {
            saveExecuted = true;
            return { ok: true };
          },
        },
        ping: {
          description: "ping",
          inputSchema: pingSchema,
          execute: async (input: unknown) => {
            pingInput = structuredClone(input);
            return { ok: true };
          },
        },
      } as never,
      toolMiddleware: [
        approvalMiddleware({
          id: "observe-approval",
          match: [
            (call) => {
              approvalTools.push(call.toolName);
              return false;
            },
          ],
        }),
        toolMiddleware({
          id: "observe",
          aroundExecute: (call, next) => {
            middlewareTools.push(call.toolName);
            return next(call.input, call.options);
          },
        }),
      ],
    });

    // The malformed call failed closed: no approval policy, no middleware, no
    // authored parse, no developer execute ran for `save`. (The SDK route has its
    // own `requiresApproval` boundary, distinct from the core route.)
    expect(saveExecuted).toBe(false);
    expect(saveParses).toBe(0);
    expect(approvalTools).not.toContain("save");
    expect(middlewareTools).not.toContain("save");

    // The valid sibling ran through every layer, approval included.
    expect(approvalTools).toContain("ping");
    expect(middlewareTools).toContain("ping");
    expect(pingParses).toBe(1);
    expect(pingInput).toEqual({ q: "hi" });

    // The generation continued to completion.
    expect(result.text).toBe("done");

    // The model's next step saw a sanitized decode-error tool result for `save`
    // that does not echo the raw wire arguments.
    const toolMessage = (prompts[1] as { role: string }[]).find(
      (message) => message.role === "tool",
    );
    const toolResult = JSON.stringify(toolMessage);
    expect(toolResult).toMatch(/save/);
    expect(toolResult).not.toContain("not-an-object");
  });
});
