/** Temporal boundary between emitted text and guarded stream completion. */

import { expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type { StreamHandle } from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";

it("uses authoritative final-seal text without recalling already emitted text", async () => {
  const seen: string[] = [];
  const runtime = adapter(
    streamSpec({ chunks: ["unsafe live"], completionText: "unsafe live" }),
  )({ kind: "temporal-stream" });
  const result = await runtime.stream(streamPrompt(), {
    model: "stream-model",
    guardrails: [
      guardrail({
        id: "final-seal-rewrite",
        on: boundary.output.text().complete(),
        run: (text) => {
          seen.push(text);
          return {
            action: "rewrite",
            value: "safe final",
            rewrite: { kind: "normalize" },
          };
        },
      }),
    ],
  });

  expect(await collect(result.textStream)).toBe("unsafe live");
  const completion = await result.completion;

  expect(seen).toEqual(["unsafe live"]);
  expect(completion.text).toBe("safe final");
  expect(completion.content).toEqual([{ type: "text", text: "safe final" }]);
  expect(completion.messages.at(-1)?.content).toEqual(completion.content);
});

it("keeps final-seal text created from an empty provider stream", async () => {
  const seen: string[] = [];
  const runtime = adapter(streamSpec({ chunks: [], completionText: "" }))({
    kind: "temporal-stream",
  });
  const result = await runtime.stream(streamPrompt(), {
    model: "stream-model",
    guardrails: [
      guardrail({
        id: "empty-final-seal-rewrite",
        on: boundary.output.text().complete(),
        run: (text) => {
          seen.push(text);
          return {
            action: "rewrite",
            value: "safe from empty",
            rewrite: { kind: "normalize" },
          };
        },
      }),
    ],
  });

  expect(await collect(result.textStream)).toBe("safe from empty");
  const completion = await result.completion;

  expect(seen).toEqual([""]);
  expect(completion.text).toBe("safe from empty");
  expect(completion.content).toEqual([
    { type: "text", text: "safe from empty" },
  ]);
});

function streamPrompt() {
  return prompt({ id: "stream-temporal-safety", prompt: "Stream text." });
}

function streamSpec(options: {
  readonly chunks: readonly string[];
  readonly completionText: string;
}): AdapterSpec<
  { readonly kind: "temporal-stream" },
  never,
  AsyncIterable<{ readonly text: string }>
> {
  return {
    providerId: "stream-temporal-safety",
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<
      StreamHandle<AsyncIterable<{ readonly text: string }>>
    > {
      const rawStream = (async function* () {
        for (const text of options.chunks) yield { text };
      })();
      return {
        rawStream,
        extractTextDelta: (chunk) => (chunk as { readonly text?: string }).text,
        completion: async () => ({
          text: options.completionText,
          content:
            options.completionText === ""
              ? []
              : [{ type: "text", text: options.completionText }],
          finishReason: "stop",
        }),
      };
    },
    appendToolRound: (messages) => messages,
    mapSettings: (settings) => ({ ...settings }),
  };
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const delta of stream) text += delta;
  return text;
}
