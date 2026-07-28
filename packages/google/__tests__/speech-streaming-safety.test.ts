import { describe, expect, it } from "vitest";
import { FinishReason } from "@google/genai";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createGoogle } from "../src";
import {
  firstAudioChunk,
  gatedClient,
  response,
  terminalResponse,
  waitFor,
} from "./speech-streaming.fixture";

describe("Google speech streaming Safety", () => {
  it("holds PCM deltas under enforcing output-media Safety until final validation", async () => {
    const fixture = gatedClient([firstAudioChunk], [terminalResponse]);
    const result = await createGoogle(fixture.client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
      guardrails: [allowAudio],
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "start" },
    });
    const held = tracked(iterator.next());
    await fixture.waiting;
    expect(held.settled()).toBe(false);

    fixture.release();

    await expect(held.promise).resolves.toMatchObject({
      value: { type: "audio" },
    });
    await expect(result.completion).resolves.toMatchObject({
      audio: { type: "data" },
    });
    expect(await remainingTypes(iterator)).toEqual(["finish"]);
  });

  it("publishes PCM deltas live when output-media Safety is report-only", async () => {
    const fixture = gatedClient([firstAudioChunk], [terminalResponse]);
    const result = await createGoogle(fixture.client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
      guardrails: [allowAudio],
      safety: { tune: { "google-stream-audio": { mode: "report" } } },
    });
    const iterator = result.fullStream[Symbol.asyncIterator]();

    await iterator.next();
    const live = tracked(iterator.next());
    await fixture.waiting;
    await waitFor(live.settled, "Report-mode audio delta was not published.");
    await expect(live.promise).resolves.toMatchObject({
      value: { type: "audio-delta" },
    });

    fixture.release();

    await expect(result.completion).resolves.toMatchObject({
      audio: { type: "data" },
    });
    expect(await remainingTypes(iterator)).toEqual(["audio", "finish"]);
  });

  it("discards enforcingly held bytes when Google terminates without STOP", async () => {
    const failed = response({
      candidates: [{ finishReason: FinishReason.OTHER, index: 0 }],
    });
    const fixture = gatedClient([firstAudioChunk], [failed]);
    const result = await createGoogle(fixture.client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
      guardrails: [allowAudio],
    });
    const seen: string[] = [];
    const reader = (async () => {
      try {
        for await (const event of result.fullStream) seen.push(event.type);
      } catch (error) {
        return error;
      }
    })();
    await fixture.waiting;

    fixture.release();
    const error = await reader;

    expect(seen).toEqual(["start"]);
    await expect(result.completion).rejects.toBe(error);
  });
});

const allowAudio = guardrail({
  id: "google-stream-audio",
  on: boundary.output.media(),
  run: () => ({ action: "allow" }),
});

function tracked<T>(promise: Promise<T>) {
  let done = false;
  void promise.then(
    () => {
      done = true;
    },
    () => {
      done = true;
    },
  );
  return { promise, settled: () => done };
}

async function remainingTypes<T extends { readonly type: string }>(
  iterator: AsyncIterator<T>,
): Promise<string[]> {
  const types: string[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return types;
    types.push(next.value.type);
  }
}
