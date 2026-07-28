import { describe, expect, it } from "vitest";
import { boundary, guardrail, GuardrailBlockedError } from "../../src/safety";
import {
  collect,
  firstImage,
  imageDeltaStream,
  secondImage,
  speechDeltaStream,
} from "./streaming-operation-safety.fixture";

describe("streaming operation Safety — final media", () => {
  it("preserves original output indexes and identity after image strip", async () => {
    const seenContexts: unknown[] = [];
    const result = await imageDeltaStream([firstImage, secondImage])({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "strip-first-stream-image-final",
          on: boundary.output.media(),
          run: (subject, context) => {
            if (
              subject.origin.kind !== "operation" ||
              subject.origin.operation !== "streamImage"
            ) {
              return { action: "allow" };
            }
            seenContexts.push(context.stream?.media);
            return subject.origin.outputIndex === 0
              ? { action: "strip", reason: "Remove first final image." }
              : { action: "allow" };
          },
        }),
      ],
    });

    const events = await collect(result.fullStream);
    const completion = await result.completion;
    const final = events.find(({ type }) => type === "image");

    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
    expect(final).toMatchObject({ outputIndex: 1, image: secondImage });
    expect(completion.images).toEqual([secondImage]);
    expect(completion.image).toBe(secondImage);
    if (final?.type !== "image") throw new Error("Expected final image.");
    expect(final.image).toBe(completion.image);
    expect(seenContexts).toEqual([
      { phase: "final", outputIndex: 0 },
      { phase: "final", outputIndex: 1 },
    ]);
  });

  it("escalates required speech strip without leaking held bytes", async () => {
    const result = await speechDeltaStream()({
      model: "speech-model",
      text: "Welcome aboard",
      guardrails: [
        guardrail({
          id: "strip-required-stream-speech-final",
          on: boundary.output.media(),
          run: () => ({ action: "strip", reason: "Remove final audio." }),
        }),
      ],
    });

    const current = await collectFailure(result.fullStream);
    const completionError = await result.completion.catch(
      (error: unknown) => error,
    );
    const late = await collectFailure(result.fullStream);

    expect(current.values).toEqual([{ type: "start" }]);
    expect(current.error).toBeInstanceOf(GuardrailBlockedError);
    expect(completionError).toBe(current.error);
    expect(late.error).toBe(current.error);
    const serialized = JSON.stringify(
      (current.error as GuardrailBlockedError).decisions,
    );
    expect(serialized).toContain('"operation":"streamSpeech"');
    expect(serialized).not.toContain("5,6");
    expect(serialized).not.toContain("audio/mpeg");
    expect(serialized).not.toContain('"source"');
  });
});

async function collectFailure<T>(
  stream: AsyncIterable<T>,
): Promise<Readonly<{ values: readonly T[]; error: unknown }>> {
  const values: T[] = [];
  try {
    for await (const value of stream) values.push(value);
  } catch (error) {
    return { values, error };
  }
  throw new Error("Expected stream to fail.");
}
