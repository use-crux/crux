import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGeneratedImageResult,
  resetHooks,
  updateHooks,
  type GenerateImageOptions,
  type ImageStreamEvent,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";
import {
  boundary,
  guardrail,
  GuardrailBlockedError,
  SafetyConfigError,
} from "../../src/safety";

const firstReference = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1]),
  mediaType: "image/png",
});
const secondReference = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([2]),
  mediaType: "image/png",
});
const editMask = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([3]),
  mediaType: "image/png",
});

describe("streaming operation Safety — image input", () => {
  afterEach(() => {
    resetHooks();
  });

  it("applies global rewrite, strip, findings, and tuning before provider code", async () => {
    const events: string[] = [];
    let normalized: GenerateImageOptions<"image-model"> | undefined;
    const disabledPolicy = guardrail({
      id: "disabled-stream-image-input",
      on: boundary.input.text(),
      run: vi.fn(() => ({ action: "block", reason: "Must stay disabled." })),
    });
    updateHooks({
      globalGuardrails: [
        guardrail({
          id: "global-stream-image-rewrite",
          on: boundary.input.text(),
          run: (_text, context) => {
            events.push("guard:text");
            context.findings.add({ type: "credential", count: 1 });
            return {
              action: "rewrite",
              value: "Edit the [REDACTED] canal",
              rewrite: { kind: "redact" },
            };
          },
        }),
      ],
    });
    const streamImage = createStreamImage(events, (input) => {
      normalized = input;
    });

    const result = await streamImage({
      model: "image-model",
      prompt: {
        text: "Edit the secret canal",
        images: [firstReference, secondReference],
      },
      guardrails: [
        disabledPolicy,
        guardrail({
          id: "strip-stream-image-reference",
          on: boundary.input.media(),
          run: (subject) => {
            const index =
              subject.origin.kind === "operation"
                ? subject.origin.partIndex
                : -1;
            events.push(`guard:media:${index}`);
            return index === 0
              ? { action: "strip", reason: "Remove first reference." }
              : { action: "allow" };
          },
        }),
      ],
      safety: {
        tune: { "disabled-stream-image-input": { enabled: false } },
      },
    });
    const completion = await result.completion;

    expect(events).toEqual([
      "guard:media:0",
      "guard:media:1",
      "guard:text",
      "normalize",
      "open",
      "validate",
    ]);
    expect(disabledPolicy.run).not.toHaveBeenCalled();
    expect(normalized?.prompt).toEqual({
      text: "Edit the [REDACTED] canal",
      images: [secondReference],
    });
    expect(normalized).not.toHaveProperty("guardrails");
    expect(normalized).not.toHaveProperty("safety");
    expect(completion.safety?.guardrails?.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: "global-stream-image-rewrite",
          action: "redact",
          findings: [{ type: "credential", count: 1 }],
        }),
        expect.objectContaining({
          guard: "strip-stream-image-reference",
          action: "strip",
        }),
      ]),
    );
    expect(Object.isFrozen(completion.safety?.guardrails?.applied)).toBe(true);
  });

  it("blocks a retained mask when the last reference is stripped", async () => {
    const events: string[] = [];
    const streamImage = createStreamImage(events, () => {});

    const error = await streamImage({
      model: "image-model",
      prompt: {
        text: "Edit the canal",
        images: [firstReference],
        mask: editMask,
      },
      guardrails: [
        guardrail({
          id: "stream-image-mask-dependency",
          on: boundary.input.media(),
          run: (subject) =>
            subject.origin.kind === "operation" &&
            subject.origin.field === "images"
              ? { action: "strip", reason: "Remove final reference." }
              : { action: "allow" },
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GuardrailBlockedError);
    expect(events).toEqual([]);
  });

  it("blocks a reference before normalization and source open", async () => {
    const events: string[] = [];
    const streamImage = createStreamImage(events, () => {});

    const error = await streamImage({
      model: "image-model",
      prompt: { text: "Edit", images: [firstReference] },
      guardrails: [
        guardrail({
          id: "block-stream-image-reference",
          on: boundary.input.media(),
          run: () => ({ action: "block", reason: "Unsafe reference." }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GuardrailBlockedError);
    expect(events).toEqual([]);
  });

  it("keeps global output text dormant and rejects it at call scope", async () => {
    const globalOutputText = vi.fn(() => ({ action: "allow" as const }));
    updateHooks({
      globalGuardrails: [
        guardrail({
          id: "dormant-stream-image-output-text",
          on: boundary.output.text(),
          run: globalOutputText,
        }),
      ],
    });
    const allowedEvents: string[] = [];
    await createStreamImage(allowedEvents, () => {})({
      model: "image-model",
      prompt: "A quiet canal",
    });
    expect(globalOutputText).not.toHaveBeenCalled();

    const rejectedEvents: string[] = [];
    const error = await createStreamImage(rejectedEvents, () => {})({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "invalid-stream-image-output-text",
          on: boundary.output.text(),
          run: () => ({ action: "allow" }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SafetyConfigError);
    expect(rejectedEvents).toEqual([]);
  });
});

type ImageCandidate = Extract<
  ImageStreamEvent,
  { readonly type: "image-preview" }
>;

function createStreamImage(
  events: string[],
  onNormalize: (input: GenerateImageOptions<"image-model">) => void,
) {
  const operation = defineStreamingOperation({
    normalize(input: GenerateImageOptions<"image-model">) {
      events.push("normalize");
      onNormalize(input);
      return input;
    },
    support: () => "supported" as const,
    open: async () => {
      events.push("open");
      return {
        events: (async function* () {})(),
        map: () => undefined as ImageCandidate | undefined,
        completion: Promise.resolve({ requestId: "image-1" }),
      };
    },
    validate(raw) {
      events.push("validate");
      return createGeneratedImageResult([secondReference], {
        warnings: [],
        execution: { kind: "native", calls: 1 },
        raw,
      });
    },
    report: () => ({}),
    conformance: [],
  });
  return bindStreamingOperation({
    definition: operation,
    provider: "test",
    operation: "streamImage",
  });
}
