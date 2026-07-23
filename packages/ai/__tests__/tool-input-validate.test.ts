/**
 * The authored validator of an AI SDK `jsonSchema(...)` tool schema is preserved.
 *
 * A tool declared with the real AI SDK `jsonSchema(schema, { validate })` helper
 * carries a custom validator that may transform the value or reject. Core runs
 * that validator exactly once, over decoded canonical `z.input` and after
 * approval and middleware (which therefore do observe the failing call), and
 * passes its transformed output to `execute`. A rejection becomes a model-visible
 * tool error that carries a stable generic reason — never the validator's own
 * message, the raw arguments, or any secret embedded in the error.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { jsonSchema } from "ai";
import { prompt } from "@use-crux/core";
import { toolMiddleware } from "@use-crux/core/adapter/tool";
import { createCruxAi } from "../src";
import { capturingEmissionModel } from "./mock-model";

const toolPrompt = prompt({
  id: "ai-sdk-tool-input-validate",
  prompt: "Use the save tool.",
});

/**
 * A real AI SDK schema whose `validate` deletes an optional sentinel is exercised
 * via the OpenAI strict profile (`note` lowered to required + nullable). The
 * validator records what it observed and either transforms `name` or rejects.
 */
function saveSchema(observed: unknown[]) {
  return jsonSchema<{ name: string }>(
    {
      type: "object",
      properties: { name: { type: "string" }, note: { type: "string" } },
      required: ["name"],
    },
    {
      validate: (value) => {
        observed.push(structuredClone(value));
        const record = value as { name?: unknown };
        if (typeof record.name !== "string" || !record.name.startsWith("x")) {
          // A hostile/careless validator embeds the raw value and a secret in
          // its error; core must forward none of it to the model.
          return {
            success: false,
            error: new Error(`Invalid: ${String(record.name)} / secret sk-LEAK-42`),
          };
        }
        return { success: true, value: { name: record.name.toUpperCase() } };
      },
    },
  );
}

describe("AI SDK jsonSchema tool — authored validate is preserved", () => {
  it("runs validate once after decode + middleware and executes the transformed value", async () => {
    const observed: unknown[] = [];
    const middlewareInputs: unknown[] = [];
    let executed: unknown;

    const { model } = capturingEmissionModel([
      {
        toolCalls: [
          { id: "c1", name: "save", args: { name: "xy", note: null } },
        ],
      },
      { text: "done" },
    ]);

    const result = await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        save: {
          description: "save",
          inputSchema: saveSchema(observed),
          execute: async (input: unknown) => {
            executed = structuredClone(input);
            return { ok: true };
          },
        },
      } as never,
      toolMiddleware: [
        toolMiddleware({
          id: "record-canonical-input",
          aroundExecute: (call, next) => {
            middlewareInputs.push(structuredClone(call.input));
            return next(call.input, call.options);
          },
        }),
      ],
    });

    // Middleware saw canonical z.input with the null sentinel already deleted.
    expect(middlewareInputs).toEqual([{ name: "xy" }]);
    // The authored validate ran exactly once, over that same canonical value.
    expect(observed).toEqual([{ name: "xy" }]);
    // Execute received the validator's transformed output, not the raw input.
    expect(executed).toEqual({ name: "XY" });
    expect(result.text).toBe("done");
  });

  it("settles a validate rejection as a model-visible tool error without executing", async () => {
    const observed: unknown[] = [];
    let executed = false;

    const { model, prompts } = capturingEmissionModel([
      {
        toolCalls: [{ id: "c1", name: "save", args: { name: "zz", note: null } }],
      },
      { text: "handled" },
    ]);

    const result = await createCruxAi().generate(toolPrompt, {
      model,
      tools: {
        save: {
          description: "save",
          inputSchema: saveSchema(observed),
          execute: async () => {
            executed = true;
            return { ok: true };
          },
        },
      } as never,
    });

    // The validator ran and rejected; the developer execute never ran.
    expect(observed).toEqual([{ name: "zz" }]);
    expect(executed).toBe(false);
    // The generation continued to completion.
    expect(result.text).toBe("handled");

    // The model's next step saw a sanitized tool-error result carrying only the
    // stable generic reason — none of the validator's own message, the embedded
    // secret, or the raw argument value ("zz") reaches the model. (The assistant's
    // own replayed tool-call still carries its input; that is the model's prior
    // output, not core's error result, so the check is scoped to the tool result.)
    const toolMessage = (prompts[1] as { role: string }[]).find(
      (message) => message.role === "tool",
    );
    const toolResult = JSON.stringify(toolMessage);
    expect(toolResult).toContain("does not satisfy the tool schema");
    expect(toolResult).not.toContain("sk-LEAK-42");
    expect(toolResult).not.toContain("zz");
  });
});
