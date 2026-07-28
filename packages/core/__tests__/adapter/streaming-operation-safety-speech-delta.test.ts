import { describe, expect, it } from "vitest";
import { boundary, guardrail } from "../../src/safety";
import {
  audioChunk,
  collect,
  finalAudio,
  speechDeltaStream,
} from "./streaming-operation-safety.fixture";

describe("streaming operation Safety — speech deltas", () => {
  it("publishes incomplete audio live without output-media enforcement", async () => {
    const result = await speechDeltaStream()({
      model: "speech-model",
      text: "Welcome aboard",
    });

    const events = await collect(result.fullStream);

    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "audio-delta",
      "audio",
      "finish",
    ]);
    if (events[1]?.type !== "audio-delta" || events[2]?.type !== "audio") {
      throw new Error("Expected one audio delta and one final audio event.");
    }
    expect(events[1].data).toBe(audioChunk);
    expect(events[2].audio).toBe(finalAudio);
    expect((await result.completion).audio).toBe(events[2].audio);
  });

  it("holds audio deltas only for enforcing output-media Safety", async () => {
    let guardedSource: unknown;
    const result = await speechDeltaStream()({
      model: "speech-model",
      text: "Welcome aboard",
      guardrails: [
        guardrail({
          id: "enforce-stream-speech-final",
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
      "audio",
      "finish",
    ]);
    expect(guardedSource).toBe(finalAudio);
    expect(guardedSource).not.toBe(audioChunk);
    expect(finalAudio.data).toBe(audioChunk);
  });

  it("keeps report-mode audio deltas live and guards only final audio", async () => {
    let guardCalls = 0;
    const result = await speechDeltaStream()({
      model: "speech-model",
      text: "Welcome aboard",
      guardrails: [
        guardrail({
          id: "report-stream-speech-final",
          mode: "report",
          on: boundary.output.media(),
          run: (subject) => {
            guardCalls += 1;
            expect(subject.part.source).toBe(finalAudio);
            return { action: "block", reason: "Would block final audio." };
          },
        }),
      ],
    });

    await expect(collect(result.fullStream)).resolves.toHaveLength(4);
    const completion = await result.completion;
    expect(guardCalls).toBe(1);
    expect(completion.safety?.guardrails?.applied[0]).toMatchObject({
      mode: "report",
      action: "block",
    });
  });
});
