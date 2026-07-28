import { describe, expect, it, vi } from "vitest";
import {
  createGeneratedImageResult,
  isUnsupportedCapabilityError,
  type GenerateImageOptions,
  type ImageStreamEvent,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";
import { fallback } from "../../src/generation/fallback";
import { router } from "../../src/routing/router";

const image = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1]),
  mediaType: "image/png",
});

describe("streaming operation routing preflight", () => {
  it("normalizes and support-checks every leaf before opening the selected route", async () => {
    const events: string[] = [];
    const streamImage = createRoutedStream(events);
    const model = router({
      classify: () => "chosen" as const,
      routes: { chosen: "selected", default: "default" },
    });

    const result = await streamImage({
      model,
      prompt: "A quiet canal",
    });
    await result.completion;

    expect(events).toEqual([
      "normalize:selected",
      "support:selected",
      "normalize:default",
      "support:default",
      "open:selected",
    ]);
  });

  it("rejects a known unsupported leaf before opening any fallback", async () => {
    const events: string[] = [];
    const streamImage = createRoutedStream(events, "blocked");

    const error = await streamImage({
      model: fallback(["supported", "blocked"]),
      prompt: "A quiet canal",
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(isUnsupportedCapabilityError(error)).toBe(true);
    expect(events).toEqual([
      "normalize:supported",
      "support:supported",
      "normalize:blocked",
      "support:blocked",
    ]);
  });
});

function createRoutedStream(events: string[], unsupported?: string) {
  const open = vi.fn();
  const operation = defineStreamingOperation({
    normalize(input: GenerateImageOptions<string>, context) {
      events.push(`normalize:${String(context.model)}`);
      return { model: input.model, prompt: input.prompt };
    },
    support: (_input, context) => {
      events.push(`support:${String(context.model)}`);
      return context.model === unsupported
        ? ("unsupported" as const)
        : ("supported" as const);
    },
    open: async (input) => {
      events.push(`open:${String(input.model)}`);
      open();
      return {
        events: (async function* () {})(),
        map: () =>
          undefined as
            | Extract<ImageStreamEvent, { readonly type: "image-preview" }>
            | undefined,
        completion: Promise.resolve({ model: String(input.model) }),
      };
    },
    validate: (raw) =>
      createGeneratedImageResult([image], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw,
      }),
    report: () => ({}),
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
  });
}
