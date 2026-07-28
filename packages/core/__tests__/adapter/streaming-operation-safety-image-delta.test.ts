import { describe, expect, it } from "vitest";
import { boundary, guardrail } from "../../src/safety";
import {
  collect,
  firstImage,
  imageChunk,
  imageDeltaStream,
} from "./streaming-operation-safety.fixture";

describe("streaming operation Safety — image deltas", () => {
  it("publishes incomplete deltas live without output-media enforcement", async () => {
    const result = await imageDeltaStream()({
      model: "image-model",
      prompt: "A quiet canal",
    });

    const events = await collect(result.fullStream);

    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-delta",
      "image",
      "finish",
    ]);
    if (events[1]?.type !== "image-delta") {
      throw new Error("Expected one image delta.");
    }
    if (events[2]?.type !== "image") {
      throw new Error("Expected one final image.");
    }
    expect(events[1].data).toBe(imageChunk);
    expect(events[2].image).toBe(firstImage);
    expect((await result.completion).image).toBe(events[2].image);
  });

  it("holds incomplete deltas under enforcing output-media Safety", async () => {
    let guardedSource: unknown;
    const result = await imageDeltaStream()({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "enforce-stream-image-final",
          on: boundary.output.media(),
          run: (subject) => {
            guardedSource = subject.part.source;
            return { action: "allow" };
          },
        }),
      ],
    });

    const events = await collect(result.fullStream);

    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image",
      "finish",
    ]);
    expect(guardedSource).toBe(firstImage);
    expect(guardedSource).not.toBe(imageChunk);
    expect(firstImage.data).toBe(imageChunk);
  });

  it("keeps report-mode deltas live and records intent on the final asset", async () => {
    let guardCalls = 0;
    const result = await imageDeltaStream()({
      model: "image-model",
      prompt: "A quiet canal",
      guardrails: [
        guardrail({
          id: "report-stream-image-final",
          mode: "report",
          on: boundary.output.media(),
          run: (subject) => {
            guardCalls += 1;
            expect(subject.part.source).toBe(firstImage);
            return { action: "strip", reason: "Would remove final image." };
          },
        }),
      ],
    });

    const events = await collect(result.fullStream);
    const completion = await result.completion;

    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-delta",
      "image",
      "finish",
    ]);
    expect(guardCalls).toBe(1);
    expect(completion.safety?.guardrails?.applied[0]).toMatchObject({
      guard: "report-stream-image-final",
      mode: "report",
      action: "strip",
    });
  });
});
