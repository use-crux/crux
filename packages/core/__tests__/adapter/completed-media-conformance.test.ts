import { describe, expect, expectTypeOf, it } from "vitest";
import {
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
  return defineCompletedOperation({
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
}

describe("completed media conformance", () => {
  it("traces image, transcription, and speech through one lifecycle law", async () => {
    const runtime = fakeCompletedRuntime().create({});

    await expect(
      completedMediaConformance([
        {
          operation: "image",
          run: () => runtime.generateImage({ model: "image" }),
        },
        {
          operation: "transcription",
          run: () => runtime.transcribe({ model: "audio" }),
        },
        {
          operation: "speech",
          run: () => runtime.generateSpeech({ model: "speech", text: "Hello" }),
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

function fakeCompletedRuntime() {
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
    image: () => fakeOperation("image"),
    transcription: () => fakeOperation("transcription"),
    speech: () =>
      defineCompletedOperation({
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
      }),
  });
}
