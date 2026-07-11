import { describe, expect, expectTypeOf, it } from "vitest";
import {
  bindCompletedOperation,
  defineCompletedOperation,
  defineProviderRuntime,
} from "../../src/adapter";
import {
  completedMediaConformance,
  fakeLoopRuntime,
} from "../../src/adapter/testing";
import {
  createGenerateSpeechResult,
  validateGenerateSpeechOptions,
} from "../../src/speech";

const audio = Object.freeze({
  type: "data" as const,
  data: new Uint8Array([1]),
  mediaType: "audio/mpeg",
});

function fakeOperation(kind: "image" | "transcription") {
  const definition = defineCompletedOperation({
    normalize: (input: Readonly<{ model: string }>) => input,
    support: () => "supported" as const,
    invoke: async () => ({ kind }),
    validate: (raw) => ({
      warnings: [],
      execution: { kind: "native" as const, calls: 1 },
      raw,
    }),
    report: () => ({ kind }),
    conformance: [],
  });
  return bindCompletedOperation({
    definition,
    provider: "fake",
    operation: kind,
  });
}

describe("completed media conformance", () => {
  it("traces image, transcription, and speech through one lifecycle law", async () => {
    const image = fakeOperation("image");
    const transcription = fakeOperation("transcription");
    const speech = fakeSpeechRuntime().create({}).generateSpeech;

    await expect(
      completedMediaConformance([
        { operation: "image", run: () => image({ model: "image" }) },
        {
          operation: "transcription",
          run: () => transcription({ model: "audio" }),
        },
        {
          operation: "speech",
          run: () => speech({ model: "speech", text: "Hello" }),
        },
      ]),
    ).resolves.toEqual([]);
  });

  it("keeps unsupported operations structurally absent", () => {
    const fake = fakeLoopRuntime({ loops: [[{ text: "unused" }]] });
    const provider = defineProviderRuntime({
      id: "without-speech",
      loop: {
        describeModel: fake.runtime.describeModel,
        bind: () => ({
          runTextLoop: fake.runtime.runTextLoop,
          runStructuredAttempt: fake.runtime.runStructuredAttempt,
          runStream: fake.runtime.runStream,
        }),
      },
    });

    const runtime = provider.create({});
    expect(runtime).not.toHaveProperty("generateSpeech");
    expectTypeOf(runtime).not.toHaveProperty("generateSpeech");
  });
});

function fakeSpeechRuntime() {
  const fake = fakeLoopRuntime({ loops: [[{ text: "unused" }]] });
  return defineProviderRuntime({
    id: "with-speech",
    loop: {
      describeModel: fake.runtime.describeModel,
      bind: () => ({
        runTextLoop: fake.runtime.runTextLoop,
        runStructuredAttempt: fake.runtime.runStructuredAttempt,
        runStream: fake.runtime.runStream,
      }),
    },
    extend: () => {
      const definition = defineCompletedOperation({
        normalize: (input: Readonly<{ model: string; text: string }>) => {
          validateGenerateSpeechOptions(input);
          return input;
        },
        support: () => "supported" as const,
        invoke: async () => ({ id: "speech-1" }),
        validate: (raw) =>
          createGenerateSpeechResult(audio, {
            warnings: [],
            execution: { kind: "native", calls: 1 },
            raw,
          }),
        report: () => ({ kind: "audio" }),
        conformance: [
          {
            name: "basic",
            model: "speech",
            input: { model: "speech", text: "Hello" },
          },
        ],
      });
      return {
        generateSpeech: bindCompletedOperation({
          definition,
          provider: "fake",
          operation: "generateSpeech",
        }),
      };
    },
  });
}
