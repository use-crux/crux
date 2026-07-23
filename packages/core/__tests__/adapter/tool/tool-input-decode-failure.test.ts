/**
 * Tool-argument decode failures fail closed before every policy.
 *
 * When a provider tool call cannot be decoded against its exact manifest, no
 * approval policy, history decision, middleware, authored Zod validation, or
 * developer `execute` runs on the malformed wire arguments. The model receives a
 * sanitized, model-visible decode error, and valid sibling tool calls continue.
 *
 * The conflict is a manifest path-shape mismatch (an object expected mid-path
 * where the model sent a string), not a valid null sentinel. This covers the
 * core tool loop; the end-to-end SDK-regime path is covered by the AI package's
 * `tool-input-decode-e2e` test through `createCruxAi().generate()`.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createToolLifecycle } from "../../../src/adapter/tool/session";
import {
  approvalMiddleware,
  toolMiddleware,
} from "../../../src/tools/middleware";
import type { AdapterResponse } from "../../../src/adapter/types";
import type { ResolvedPrompt } from "../../../src/resolver/types";
import { strictCapabilities } from "../structured-output/capability-fixtures";

function resolvedWith(partial: Partial<ResolvedPrompt>): ResolvedPrompt {
  return { settings: {}, ...partial } as ResolvedPrompt;
}

const USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  inputTokenDetails: {},
  outputTokenDetails: {},
} as const;

// Strict lowering makes the nested optional `note` required+nullable and records
// a delete-null-sentinel op at ["outer", "note"]. A wire value whose `outer` is a
// string cannot be traversed to that leaf, so decoding fails.
function makeTools(spies: {
  save: ReturnType<typeof vi.fn>;
  other: ReturnType<typeof vi.fn>;
  onParse: () => void;
}) {
  return {
    save: {
      description: "save",
      parameters: z
        .object({ outer: z.object({ note: z.string().optional() }) })
        .transform((value) => {
          spies.onParse();
          return value;
        }),
      execute: spies.save,
    },
    other: {
      description: "other",
      parameters: z.object({ q: z.string() }),
      execute: spies.other,
    },
  };
}

describe("tool decode failure fails closed", () => {
  it("core route: settles a sanitized decode error before any policy; siblings continue", async () => {
    const save = vi.fn(async () => "saved");
    const other = vi.fn(async () => "other");
    const middlewareTools: string[] = [];
    const approvalTools: string[] = [];
    let parses = 0;

    const lifecycle = createToolLifecycle({
      regime: "core",
      resolved: resolvedWith({
        tools: makeTools({ save, other, onParse: () => (parses += 1) }),
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
            id: "observe-middleware",
            aroundExecute: (call, next) => {
              middlewareTools.push(call.toolName);
              return next(call.input, call.options);
            },
          }),
        ],
      }),
      promptId: "p1",
      structuredOutputCapabilities: strictCapabilities,
    });

    const response: AdapterResponse = {
      text: "",
      toolCalls: [
        { id: "tc1", name: "save", args: { outer: "not-an-object" } },
        { id: "tc2", name: "other", args: { q: "ok" } },
      ],
      usage: { ...USAGE },
      finishReason: "tool_calls",
      responseId: undefined,
      actualModelId: undefined,
    };

    const round = await lifecycle.executeRound(response, [
      { role: "user", content: "go" },
    ]);

    expect(round.kind).toBe("completed");
    const results = round.kind === "completed" ? round.results : [];
    const saveResult = results.find((r) => r.name === "save");
    const otherResult = results.find((r) => r.name === "other");

    // Decode failed closed: sanitized, model-visible error; nothing downstream
    // ran for `save` — no approval policy, middleware, safeParse, or execute.
    expect(saveResult?.isError).toBe(true);
    expect(saveResult?.modelOutputError).toMatch(/decode/i);
    expect(JSON.stringify(saveResult)).not.toContain("not-an-object");
    expect(save).not.toHaveBeenCalled();
    expect(middlewareTools).not.toContain("save");
    expect(approvalTools).not.toContain("save");
    expect(parses).toBe(0);

    // Valid sibling continues through every layer.
    expect(otherResult?.isError).toBeFalsy();
    expect(other).toHaveBeenCalled();
    expect(middlewareTools).toContain("other");
    expect(approvalTools).toContain("other");
  });
});
