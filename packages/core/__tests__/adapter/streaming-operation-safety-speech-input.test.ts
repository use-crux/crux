import { describe, expect, it, vi } from "vitest";
import {
  createGenerateSpeechResult,
  type GenerateSpeechOptions,
} from "../../src";
import {
  bindStreamingOperation,
  defineStreamingOperation,
} from "../../src/adapter";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";

const generatedAudio = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: "audio/mpeg",
});

describe("streaming operation Safety — speech input", () => {
  it("rewrites text and instructions before normalization and open", async () => {
    const events: string[] = [];
    let normalized: GenerateSpeechOptions<"speech-model"> | undefined;
    const streamSpeech = createStreamSpeech(events, (input) => {
      normalized = input;
    });
    const textPolicy = guardrail({
      id: "stream-speech-text",
      on: boundary.input.text(),
      run: vi.fn((_text, context) => {
        events.push("guard:text");
        context.findings.add({ type: "secret", count: 1 });
        return {
          action: "rewrite",
          value: "Read [REDACTED] aloud",
          rewrite: { kind: "redact" },
        };
      }),
    });
    const instructionPolicy = guardrail({
      id: "stream-speech-instructions",
      on: boundary.input.instructions(),
      run: () => {
        events.push("guard:instructions");
        return {
          action: "rewrite",
          value: "Use a neutral voice",
          rewrite: { kind: "normalize" },
        };
      },
    });

    const result = await streamSpeech({
      model: "speech-model",
      text: "Read secret aloud",
      instructions: "Imitate a secret voice",
      guardrails: [textPolicy, instructionPolicy],
    });
    const completion = await result.completion;

    expect(events).toEqual([
      "guard:text",
      "guard:instructions",
      "normalize",
      "open",
      "validate",
    ]);
    expect(normalized).toMatchObject({
      text: "Read [REDACTED] aloud",
      instructions: "Use a neutral voice",
    });
    expect(normalized).not.toHaveProperty("guardrails");
    expect(completion.safety?.guardrails?.applied[0]).toMatchObject({
      guard: "stream-speech-text",
      action: "redact",
      findings: [{ type: "secret", count: 1 }],
    });
    expect(Object.isFrozen(completion.safety)).toBe(true);
  });

  it("blocks before provider normalization or source open", async () => {
    const events: string[] = [];
    const streamSpeech = createStreamSpeech(events, () => {});

    const error = await streamSpeech({
      model: "speech-model",
      text: "Welcome aboard",
      instructions: "Imitate a secret voice",
      guardrails: [
        guardrail({
          id: "block-stream-speech-instructions",
          on: boundary.input.instructions(),
          run: () => ({ action: "block", reason: "Unsafe instructions." }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GuardrailBlockedError);
    expect(events).toEqual([]);
  });
});

function createStreamSpeech(
  events: string[],
  onNormalize: (input: GenerateSpeechOptions<"speech-model">) => void,
) {
  const operation = defineStreamingOperation({
    normalize(input: GenerateSpeechOptions<"speech-model">) {
      events.push("normalize");
      onNormalize(input);
      return input;
    },
    support: () => "supported" as const,
    open: async () => {
      events.push("open");
      return {
        events: (async function* () {})(),
        map: () => undefined,
        completion: Promise.resolve({ requestId: "speech-1" }),
      };
    },
    validate(raw) {
      events.push("validate");
      return createGenerateSpeechResult(generatedAudio, {
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
    operation: "streamSpeech",
  });
}
