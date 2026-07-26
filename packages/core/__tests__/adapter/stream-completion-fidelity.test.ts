/** Edge-case fidelity for guarded Core stream completion assembly. */

import { describe, expect, it } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type {
  StreamCompletionMetadata,
  StreamHandle,
} from "../../src/adapter/types";
import { prompt } from "../../src/prompt/prompt";
import { boundary, guardrail } from "../../src/safety";
import type { AssistantContentPart } from "../../src/types/content";

describe("stream completion fidelity — Core", () => {
  it("keeps independently rewritten live slots around buffered media", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1]),
      mediaType: "image/png",
    });
    const result = await start(
      {
        content: [
          { type: "text", text: "alpha" },
          image,
          { type: "text", text: "beta" },
        ],
        chunks: ["alpha", "beta"],
      },
      [
        guardrail({
          id: "independent-live-slots",
          on: boundary.output.text().deltas(),
          run: (text) => ({
            action: "rewrite",
            value: text === "alpha" ? "A" : "B",
            rewrite: { kind: "normalize" },
          }),
        }),
      ],
    );

    expect(await collect(result.textStream)).toBe("AB");
    const completion = await result.completion;
    expect(completion.content).toEqual([
      { type: "text", text: "A" },
      image,
      { type: "text", text: "B" },
    ]);
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });

  it("assembles canonical assistant messages without an enabled policy", async () => {
    const result = await start(
      { content: [{ type: "text", text: "plain" }], chunks: ["plain"] },
      [],
    );

    await collect(result.textStream);
    const completion = await result.completion;
    expect(completion.messages.at(-1)?.content).toEqual(completion.content);
  });

  it("guards a reused part object by its original slot index", async () => {
    const shared = Object.freeze({ type: "text" as const, text: "live" });
    const seen: string[] = [];
    const result = await start(
      { content: [shared, shared], chunks: ["live"] },
      [
        guardrail({
          id: "shared-part-slots",
          on: boundary.output.text().deltas(),
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: seen.length === 1 ? "safe live" : "safe buffered",
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    );

    expect(await collect(result.textStream)).toBe("safe live");
    const completion = await result.completion;

    expect(seen).toEqual(["live", "live"]);
    expect(completion.content).toEqual([
      { type: "text", text: "safe live" },
      { type: "text", text: "safe buffered" },
    ]);
  });

  it("guards only the buffered suffix of a partially represented text slot", async () => {
    const seen: string[] = [];
    const result = await start(
      {
        content: [{ type: "text", text: "live buffered" }],
        chunks: ["live "],
      },
      [
        guardrail({
          id: "partial-live-slot",
          on: boundary.output.text().deltas(),
          run: (text) => {
            seen.push(text);
            return {
              action: "rewrite",
              value: text === "live " ? "safe " : "guarded",
              rewrite: { kind: "normalize" },
            };
          },
        }),
      ],
    );

    expect(await collect(result.textStream)).toBe("safe ");
    const completion = await result.completion;

    expect(seen).toEqual(["live ", "buffered"]);
    expect(completion.content).toEqual([
      { type: "text", text: "safe guarded" },
    ]);
  });

  it("does not re-run rewritten live text when completion metadata is absent", async () => {
    const seen: string[] = [];
    const result = await start({ chunks: ["unsafe"], completion: false }, [
      guardrail({
        id: "metadata-free-live-text",
        on: boundary.output.text().deltas(),
        run: (text) => {
          seen.push(text);
          return {
            action: "rewrite",
            value: "safe",
            rewrite: { kind: "normalize" },
          };
        },
      }),
    ]);

    expect(await collect(result.textStream)).toBe("safe");
    const completion = await result.completion;

    expect(seen).toEqual(["unsafe"]);
    expect(completion.text).toBe("safe");
    expect(completion.content).toEqual([{ type: "text", text: "safe" }]);
  });

  it("publishes provider text without exposing the provider iterable", async () => {
    let providerStream: AsyncIterable<{ readonly text: string }> | undefined;
    const runtime = adapter(
      streamSpec({
        chunks: ["visible"],
        captureRaw: (stream) => {
          providerStream = stream;
        },
      }),
    )({ kind: "fidelity-stream" });

    const result = await runtime.stream(streamPrompt(), {
      model: "stream-model",
    });

    expect(providerStream).toBeDefined();
    expect("raw" in result).toBe(false);
    expect(await collect(result.textStream)).toBe("visible");
  });

  it("keeps a fully stripped completion empty across every projection", async () => {
    const image = Object.freeze({
      type: "image" as const,
      source: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
    });
    const result = await start({ content: [image], chunks: [] }, [
      guardrail({
        id: "strip-only-completion-part",
        on: boundary.output.media(),
        run: () => ({ action: "strip", reason: "remove final part" }),
      }),
    ]);

    expect(await collect(result.textStream)).toBe("");
    const completion = await result.completion;

    expect(completion.content).toEqual([]);
    expect(completion.finalStep.content).toEqual([]);
    expect(completion.messages.at(-1)?.content).toEqual([]);
  });
});

type Guardrail = ReturnType<typeof guardrail>;

async function start(options: SpecOptions, guardrails: readonly Guardrail[]) {
  const runtime = adapter(streamSpec(options))({ kind: "fidelity-stream" });
  return runtime.stream(streamPrompt(), {
    model: "stream-model",
    guardrails: [...guardrails],
  });
}

function streamPrompt() {
  return prompt({ id: "stream-completion-fidelity", prompt: "Stream." });
}

interface SpecOptions {
  readonly content?: readonly AssistantContentPart[];
  readonly chunks: readonly string[];
  readonly completion?: boolean;
  readonly captureRaw?: (
    stream: AsyncIterable<{ readonly text: string }>,
  ) => void;
}

function streamSpec(
  options: SpecOptions,
): AdapterSpec<
  { readonly kind: "fidelity-stream" },
  never,
  AsyncIterable<{ readonly text: string }>
> {
  return {
    providerId: "stream-completion-fidelity",
    async call() {
      throw new Error("not used");
    },
    async stream(): Promise<
      StreamHandle<AsyncIterable<{ readonly text: string }>>
    > {
      const rawStream = (async function* () {
        for (const text of options.chunks) yield { text };
      })();
      options.captureRaw?.(rawStream);
      return {
        rawStream,
        extractTextDelta: (chunk) => (chunk as { readonly text?: string }).text,
        completion: async (): Promise<StreamCompletionMetadata | undefined> =>
          options.completion === false
            ? undefined
            : {
                text: options.chunks.join(""),
                ...(options.content ? { content: options.content } : {}),
                finishReason: "stop",
              },
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
