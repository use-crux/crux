/**
 * Validation retry and constraint regeneration share one `maxSteps`
 * provider-call budget. No regeneration performs a provider call once the budget
 * is exhausted.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter } from "../../../src/adapter/define-adapter";
import type { AdapterSpec, StreamHandle } from "../../../src/adapter/types";
import { prompt } from "../../../src/prompt/prompt";
import { boundary, constraint } from "../../../src/safety";
import { permissiveCapabilities } from "./capability-fixtures";

function countingAdapter(text: string) {
  const calls = { count: 0 };
  const spec: AdapterSpec<object, { text: string }, AsyncIterable<string>> = {
    providerId: "counting",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      calls.count += 1;
      return {
        raw: { text },
        extracted: { text, finishReason: "stop" },
      };
    },
    async stream(): Promise<StreamHandle<AsyncIterable<string>>> {
      return {
        rawStream: (async function* () {})(),
        extractTextDelta: (c) => (typeof c === "string" ? c : undefined),
        completion: async () => ({}),
      };
    },
    appendToolRound: (m) => m,
    mapSettings: () => ({}),
  };
  return { runtime: adapter(spec)({}), calls };
}

const structured = prompt({
  id: "budget-structured",
  input: z.object({ message: z.string() }),
  output: z.object({ ok: z.boolean() }),
  prompt: ({ input }) => input.message,
});

describe("shared maxSteps provider-call budget", () => {
  it("bounds constraint regeneration by maxSteps, not constraintMaxRetries", async () => {
    const { runtime, calls } = countingAdapter('{"ok":true}');
    const alwaysFails = constraint({
      id: "never-satisfied",
      on: boundary.output.text(),
      maxRetries: 20,
      run: () => ({ pass: false as const, feedback: "regenerate" }),
    });

    await runtime
      .generate(structured, {
        model: "m",
        input: { message: "go" },
        maxSteps: 3,
        constraints: [alwaysFails],
      })
      .catch(() => undefined);

    // Exactly maxSteps provider calls: 1 initial + 2 regenerations, then budget
    // is exhausted and no further provider call is made.
    expect(calls.count).toBe(3);
  });

  it("does not exceed maxSteps when validation retry is also configured", async () => {
    const { runtime, calls } = countingAdapter("not json");
    await runtime
      .generate(structured, {
        model: "m",
        input: { message: "go" },
        maxSteps: 2,
        validationRetry: { maxRetries: 20 },
      })
      .catch(() => undefined);

    expect(calls.count).toBe(2);
  });
});
