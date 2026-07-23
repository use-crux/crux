/** Core-dialect terminal object/path synchronization. */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type { AdapterResponse } from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import { permissiveCapabilities } from "./structured-output/capability-fixtures";

const outputSchema = z.object({
  profile: z.object({ label: z.string(), count: z.number() }),
});

const structuredPrompt = prompt({
  id: "language-terminal-object-core",
  prompt: "return JSON",
  output: outputSchema,
});

describe("language terminal object Safety — core dialect", () => {
  it("writes an immutable path rewrite through downstream both and the envelope", async () => {
    const rawText = '{"profile":{"label":"initial","count":1}}';
    const raw = Object.freeze({ text: rawText });
    const pathSeen: unknown[] = [];
    const bothSeen: unknown[] = [];
    const runtime = adapter(structuredAdapter(raw, response(rawText)))({
      kind: "terminal-object-core",
    });

    const result = await runtime.generate(structuredPrompt, {
      model: "test-model",
      validationRetry: { maxRetries: 0 },
      guardrails: [
        guardrail({
          id: "rewrite-core-structured-path",
          on: boundary.output
            .path<z.infer<typeof outputSchema>>()("profile.label"),
          run: (label) => {
            pathSeen.push(label);
            return {
              action: "rewrite",
              value: "terminal",
              rewrite: { kind: "normalize" },
            };
          },
        }),
        guardrail({
          id: "inspect-core-rewritten-both",
          on: boundary.output.both<z.infer<typeof outputSchema>>(),
          run: (output) => {
            bothSeen.push(output);
            return { action: "allow" };
          },
        }),
      ],
    });

    const guardedText = '{"profile":{"label":"terminal","count":1}}';
    expect(pathSeen).toEqual(["initial"]);
    expect(bothSeen).toEqual([
      {
        text: guardedText,
        object: { profile: { label: "terminal", count: 1 } },
      },
    ]);
    expect(result.raw).toBe(raw);
    expect(result.text).toBe(guardedText);
    expect(result.object).toEqual({
      profile: { label: "terminal", count: 1 },
    });
    expect(result.finalStep.text).toBe(guardedText);
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: guardedText }],
    });
  });
});

function structuredAdapter(
  raw: { readonly text: string },
  extracted: AdapterResponse,
): AdapterSpec<
  { readonly kind: "terminal-object-core" },
  { readonly text: string },
  never
> {
  return {
    providerId: "terminal-object-core",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      return { raw, extracted };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound(messages) {
      return messages;
    },
    mapSettings(settings) {
      return { ...settings };
    },
  };
}

function response(text: string): AdapterResponse {
  return {
    text,
    usage: undefined,
    finishReason: "stop",
    responseId: undefined,
    actualModelId: undefined,
  };
}
