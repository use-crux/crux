/**
 * Logical usage and cost span every billable attempt (RFC #173, law 7).
 *
 * A caller billed for three provider calls must not be told they used the tokens
 * of one. Aggregate billing is deliberately NOT a publication of rejected output:
 * the discarded attempt's text, transcript, steps, and warnings stay invisible,
 * but its tokens and cost still count.
 *
 * The completeness rule is preserved in both directions — if any billable attempt
 * omits usage, the logical total is omitted rather than under-reported.
 *
 * @module
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { adapter as makeAdapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec, StreamHandle } from "../../src/adapter/types";
import type { TokenUsage } from "../../src/generation/types";
import { prompt as makePrompt } from "../../src/prompt/prompt";
import { boundary, constraint } from "../../src/safety";
import { permissiveCapabilities } from "./structured-output/capability-fixtures";

function usage(input: number, output: number): TokenUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
    inputTokenDetails: {},
    outputTokenDetails: {},
  };
}

interface Attempt {
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly cost?: number;
}

/** A native adapter that streams one scripted attempt per provider call. */
function streamingAdapter(attempts: readonly Attempt[]) {
  const queue = [...attempts];
  const spec: AdapterSpec<object, never, never> = {
    providerId: "billing-native",
    structuredOutput: { accepts: permissiveCapabilities },
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<StreamHandle<never>> {
      const attempt = queue.shift() ?? attempts[attempts.length - 1]!;
      async function* chunks() {
        yield { text: attempt.text };
      }
      return {
        rawStream: chunks() as never,
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({
          finishReason: "stop" as const,
          ...(attempt.usage ? { usage: attempt.usage } : {}),
          ...(attempt.cost !== undefined ? { cost: attempt.cost } : {}),
        }),
      };
    },
    appendToolRound: (messages) => messages,
    mapSettings: () => ({}),
  };
  return makeAdapter(spec)({});
}

const schema = z.object({ title: z.string(), count: z.number() });
const structuredPrompt = makePrompt({
  id: "billing-structured",
  prompt: "json",
  output: schema,
});
const countPositive = constraint({
  id: "count-positive",
  on: boundary.output.object<{ title: string; count: number }>(),
  run: (value: { title: string; count: number }) =>
    value.count > 0
      ? { pass: true }
      : { pass: false, feedback: "count must be positive" },
});

async function runCoordinated(attempts: readonly Attempt[]) {
  const result = await streamingAdapter(attempts).stream(structuredPrompt, {
    model: "billing-model",
    constraints: [countPositive],
  });
  let text = "";
  for await (const delta of result.textStream) text += delta;
  return { text, completion: await result.completion };
}

describe("logical billing totals", () => {
  it("counts a discarded attempt's tokens in the logical usage", async () => {
    const { text, completion } = await runCoordinated([
      { text: '{"title":"a","count":-1}', usage: usage(10, 5) },
      { text: '{"title":"a","count":2}', usage: usage(20, 7) },
    ]);

    // The rejected attempt published nothing…
    expect(text).toBe('{"title":"a","count":2}');
    expect(completion.object).toEqual({ title: "a", count: 2 });
    // …but the caller was billed for BOTH provider calls.
    expect(completion.usage?.inputTokens).toBe(30);
    expect(completion.usage?.outputTokens).toBe(12);
    expect(completion.usage?.totalTokens).toBe(42);
  });

  it("counts a discarded attempt's cost in the logical cost", async () => {
    const { completion } = await runCoordinated([
      { text: '{"title":"a","count":-1}', usage: usage(10, 5), cost: 0.001 },
      { text: '{"title":"a","count":2}', usage: usage(20, 7), cost: 0.002 },
    ]);

    expect(completion.cost).toBeCloseTo(0.003, 10);
  });

  it("omits logical usage when any billable attempt was unmetered", async () => {
    const { completion } = await runCoordinated([
      // The discarded attempt reported no usage: the true total is unknowable,
      // and reporting only the accepted attempt would under-report it.
      { text: '{"title":"a","count":-1}' },
      { text: '{"title":"a","count":2}', usage: usage(20, 7) },
    ]);

    expect(completion.object).toEqual({ title: "a", count: 2 });
    expect(completion.usage).toBeUndefined();
  });

  it("keeps steps and transcript describing only the committed attempt", async () => {
    const { completion } = await runCoordinated([
      { text: '{"title":"a","count":-1}', usage: usage(10, 5) },
      { text: '{"title":"a","count":2}', usage: usage(20, 7) },
    ]);

    // Aggregate billing is not a publication of rejected output: the public
    // step list still describes one committed provider call, so logical usage
    // deliberately does NOT equal the sum of `steps[].usage`.
    expect(completion.steps).toHaveLength(1);
    expect(completion.steps[0]?.usage?.totalTokens).toBe(27);
    expect(completion.usage?.totalTokens).toBe(42);
    expect(JSON.stringify(completion.messages)).not.toContain("count\":-1");
  });
});
