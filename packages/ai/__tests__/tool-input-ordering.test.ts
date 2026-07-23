/**
 * SDK-regime tool-input execution ordering.
 *
 * The SDK owns the tool loop and never passes through the core `gate()`, so the
 * decode boundary must run first: wire args → exact plan decode → approval and
 * middleware over canonical z.input → authored safeParse exactly once →
 * execute(safeParse.data). Compiled against the OpenAI strict tool profile, an
 * optional property arrives as a null sentinel that must be deleted before any
 * policy observes it.
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
  id: "ai-sdk-tool-input-ordering",
  prompt: "Use the save tool.",
});

describe("AI SDK tool-input ordering", () => {
  it("decodes the null sentinel before approval and middleware, safeParses once after a rewrite", async () => {
    let parses = 0;
    let executed: unknown;
    const middlewareInputs: unknown[] = [];
    let approvalSawSentinel = false;

    // OpenAI strict lowers `note` (optional) to required+nullable, so the model
    // returns it as the null sentinel; decode must delete it before any layer.
    const schema = z
      .object({ name: z.string(), note: z.string().optional() })
      .transform((value) => {
        parses += 1;
        return value;
      });

    const { model } = capturingEmissionModel([
      {
        toolCalls: [
          { id: "c1", name: "save", args: { name: "x", note: null } },
        ],
      },
      { text: "done" },
    ]);

    await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        save: {
          description: "save",
          inputSchema: schema,
          execute: async (input: unknown) => {
            executed = structuredClone(input);
            return { ok: true };
          },
        },
      } as never,
      toolMiddleware: [
        approvalMiddleware({
          id: "gate-on-sentinel",
          // Would require (and suspend for) approval if the null sentinel were
          // still present when approval is evaluated. The tool executing proves
          // approval observed canonical z.input with the sentinel already gone.
          match: [
            (call) => {
              if ("note" in (call.input as Record<string, unknown>)) {
                approvalSawSentinel = true;
                return true;
              }
              return false;
            },
          ],
        }),
        toolMiddleware({
          id: "rewrite-canonical-input",
          aroundExecute: (call, next) => {
            middlewareInputs.push(structuredClone(call.input));
            // Rewrite canonical z.input; the authored safeParse runs after this.
            return next(
              { ...(call.input as Record<string, unknown>), name: "rewritten" },
              call.options,
            );
          },
        }),
      ],
    });

    // Middleware observed canonical z.input: the sentinel is gone.
    expect(middlewareInputs).toEqual([{ name: "x" }]);
    // Approval evaluated canonical z.input (sentinel deleted) → never gated.
    expect(approvalSawSentinel).toBe(false);
    // The authored tool ran (approval did not suspend), safeParse ran exactly
    // once after the middleware rewrite, and execute received safeParse.data.
    expect(parses).toBe(1);
    expect(executed).toEqual({ name: "rewritten" });
  });
});
