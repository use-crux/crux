/**
 * A structured step-text rewrite must not invoke the authored Zod parser a
 * second time. Schema validity belongs to the single authoritative post-Safety
 * parse; step-rewrite synchronization only checks JSON validity.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter } from "../../../src/adapter/define-adapter";
import type { AdapterResponse, AdapterSpec } from "../../../src/adapter/types";
import { prompt } from "../../../src/prompt/prompt";
import { boundary, guardrail } from "../../../src/safety";
import { permissiveCapabilities } from "./capability-fixtures";

function structuredAdapter(text: string) {
  const raw: AdapterResponse = { text, finishReason: "stop" };
  const spec: AdapterSpec<object, AdapterResponse, never> = {
    providerId: "step-rewrite",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      return { raw, extracted: raw };
    },
    async stream() {
      throw new Error("not used");
    },
    appendToolRound: (m) => m,
    mapSettings: () => ({}),
  };
  return adapter(spec)({});
}

describe("structured step rewrite runs the authored parser once", () => {
  it("does not double-run a preprocess/transform across a step rewrite", async () => {
    let parses = 0;
    const schema = z
      .object({ v: z.string() })
      .transform((value) => {
        parses += 1;
        return value;
      });

    const structured = prompt({
      id: "step-rewrite-count",
      prompt: "return json",
      output: schema,
    });

    const result = await structuredAdapter('{"v":"unsafe"}').generate(
      structured,
      {
        model: "m",
        guardrails: [
          guardrail({
            id: "rewrite-structured-text",
            on: boundary.output.text(),
            run: (text) => ({
              action: "rewrite",
              value: text.replace("unsafe", "safe"),
              rewrite: { kind: "normalize" },
            }),
          }),
        ],
      },
    );

    expect(result.object).toEqual({ v: "safe" });
    // Exactly one authoritative parse for the completed candidate.
    expect(parses).toBe(1);
  });
});
