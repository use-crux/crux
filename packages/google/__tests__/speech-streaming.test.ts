import { describe, expect, expectTypeOf, it } from "vitest";
import type { SpeechStreamEvent } from "@use-crux/core";
import {
  createGoogle,
  type GoogleStreamSpeech,
  type GoogleStreamSpeechResult,
} from "../src";
import {
  cancellableClient,
  clientWith,
  collect,
  firstAudioChunk,
  PCM_MEDIA_TYPE,
  secondAudioChunk,
  terminalResponse,
  waitFor,
} from "./speech-streaming.fixture";

describe("Google speech streaming", () => {
  it("maps native PCM chunks and preserves the exact terminal response", async () => {
    const { client, generateContentStream } = clientWith([
      firstAudioChunk,
      secondAudioChunk,
      terminalResponse,
    ]);
    const google = createGoogle(client, { cachedContent: false });

    const result = await google.streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "Welcome aboard",
      voice: "Kore",
      language: "en",
      extra: { temperature: 0.8 },
    });
    const events = await collect(result.fullStream);
    const completion = await result.completion;

    expectTypeOf(google.streamSpeech).toBeFunction();
    expectTypeOf(result).toMatchTypeOf<GoogleStreamSpeechResult>();
    expectTypeOf<GoogleStreamSpeech>().toBeFunction();
    expect(generateContentStream).toHaveBeenCalledOnce();
    expect(generateContentStream).toHaveBeenCalledWith({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ role: "user", parts: [{ text: "Welcome aboard" }] }],
      config: {
        abortSignal: expect.any(AbortSignal),
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "en",
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
        temperature: 0.8,
      },
    });
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "audio-delta",
      "audio-delta",
      "audio",
      "finish",
    ]);
    const deltas = events.filter(
      (
        event: SpeechStreamEvent,
      ): event is Extract<
        SpeechStreamEvent,
        { readonly type: "audio-delta" }
      > => event.type === "audio-delta",
    );
    expect(
      deltas.map(({ sequence, mediaType, data }) => ({
        sequence,
        mediaType,
        data: [...data],
      })),
    ).toEqual([
      { sequence: 0, mediaType: PCM_MEDIA_TYPE, data: [1, 2, 3] },
      { sequence: 1, mediaType: PCM_MEDIA_TYPE, data: [4, 5, 6] },
    ]);
    expect(completion.raw).toBe(terminalResponse);
    expect(completion.raw.usageMetadata).toBe(terminalResponse.usageMetadata);
    expect(completion).not.toHaveProperty("providerMetadata");
    expect(completion.warnings).toEqual([]);
    expect(completion.audio).toMatchObject({
      type: "data",
      mediaType: PCM_MEDIA_TYPE,
    });
    expect(completion.audio.data).toBeInstanceOf(Blob);
    expect(await audioBytes(completion.audio.data)).toEqual([1, 2, 3, 4, 5, 6]);
    const final = events.find(
      (
        event,
      ): event is Extract<SpeechStreamEvent, { readonly type: "audio" }> =>
        event.type === "audio",
    );
    expect(final?.audio).toBe(completion.audio);
  });

  it("rejects unsupported models and controls before SDK I/O", async () => {
    const cases = [
      { model: "gemini-2.5-flash-preview-tts", text: "x" },
      { model: "gemini-2.5-pro-preview-tts", text: "x" },
      { model: "gemini-future-voice-model", text: "x" },
      {
        model: "models/gemini-3.1-flash-tts-preview",
        text: "x",
      },
      {
        model: "gemini-3.1-flash-tts-preview",
        text: "x",
        outputFormat: "wav",
      },
      {
        model: "gemini-3.1-flash-tts-preview",
        text: "x",
        instructions: "whisper",
      },
      { model: "gemini-3.1-flash-tts-preview", text: "x", speed: 2 },
    ] as const;

    for (const options of cases) {
      const { client, generateContentStream } = clientWith([terminalResponse]);
      await expect(
        createGoogle(client, { cachedContent: false }).streamSpeech(options),
      ).rejects.toMatchObject({ code: "unsupported_capability" });
      expect(generateContentStream).not.toHaveBeenCalled();
    }
  });

  it("propagates caller abort through the SDK source with exact identity", async () => {
    const reason = new Error("caller stopped");
    const controller = new AbortController();
    const fixture = cancellableClient([firstAudioChunk]);
    const result = await createGoogle(fixture.client, {
      cachedContent: false,
    }).streamSpeech({
      model: "gemini-3.1-flash-tts-preview",
      text: "x",
      abortSignal: controller.signal,
    });
    const reader = collect(result.fullStream).catch((error: unknown) => error);
    await waitFor(
      () => fixture.requestSignal() !== undefined,
      "Google speech stream was not opened.",
    );

    controller.abort(reason);

    expect(await reader).toBe(reason);
    await expect(result.completion).rejects.toBe(reason);
    expect(fixture.requestSignal()?.reason).toBe(reason);
    await expect(fixture.returned).resolves.toBeUndefined();
  });
});

async function audioBytes(data: Uint8Array | Blob): Promise<number[]> {
  return [
    ...(data instanceof Uint8Array
      ? data
      : new Uint8Array(await data.arrayBuffer())),
  ];
}
