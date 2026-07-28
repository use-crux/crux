import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type OpenAI from "openai";
import type { SpeechStreamEvent } from "@use-crux/core";
import { createOpenAI } from "../src";

describe("OpenAI speech streaming", () => {
  it("maps native response-body chunks in order and assembles the exact completion", async () => {
    const raw = responseWithChunks([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ]);
    const create = vi.fn(async () => raw);
    const completedRead = vi.spyOn(raw, "arrayBuffer");
    const openai = createOpenAI(client(create));

    const result = await openai.streamSpeech({
      model: "gpt-4o-mini-tts",
      text: "Hello from Crux",
      voice: "alloy",
      outputFormat: "wav",
      instructions: "Speak warmly",
      speed: 1.25,
    });
    const events = await collect(result.fullStream);
    const completion = await result.completion;

    expectTypeOf(result.fullStream).toMatchTypeOf<
      AsyncIterable<SpeechStreamEvent>
    >();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      {
        model: "gpt-4o-mini-tts",
        input: "Hello from Crux",
        voice: "alloy",
        response_format: "wav",
        instructions: "Speak warmly",
        speed: 1.25,
        stream_format: "audio",
      },
      { signal: expect.any(AbortSignal) },
    );
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
      { sequence: 0, mediaType: "audio/wav", data: [1, 2] },
      { sequence: 1, mediaType: "audio/wav", data: [3, 4] },
    ]);
    expect(completion.raw).toBe(raw);
    expect(completion.warnings).toEqual([]);
    expect(completion.execution).toEqual({ kind: "native", calls: 1 });
    expect(completion).not.toHaveProperty("providerMetadata");
    expect([...(await dataBytes(completion.audio))]).toEqual([1, 2, 3, 4]);
    expect(completedRead).not.toHaveBeenCalled();
    const final = events.find(
      (
        event: SpeechStreamEvent,
      ): event is Extract<SpeechStreamEvent, { readonly type: "audio" }> =>
        event.type === "audio",
    );
    expect(final?.audio).toBe(completion.audio);
  });

  it("rejects unsupported models and controls before native I/O", async () => {
    const create = vi.fn(async () => responseWithChunks([new Uint8Array([1])]));
    const openai = createOpenAI(client(create));

    await expect(
      openai.streamSpeech({
        model: "custom-speech-model",
        text: "Hello",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    await expect(
      openai.streamSpeech({
        model: "tts-1",
        text: "Hello",
        instructions: "Speak warmly",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    await expect(
      openai.streamSpeech({
        model: "gpt-4o-mini-tts",
        text: "Hello",
        outputFormat: "m4a",
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    await expect(
      openai.streamSpeech({
        model: "gpt-4o-mini-tts",
        text: "Hello",
        extra: { stream_format: "sse" },
      } as never),
    ).rejects.toMatchObject({ code: "unsupported_capability" });

    expect(create).not.toHaveBeenCalled();
  });

  it("cancels the SDK signal and active response-body reader with exact identity", async () => {
    const reason = new Error("caller stopped");
    const controller = new AbortController();
    const cancelled = deferred<unknown>();
    const raw = new Response(
      new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new Uint8Array([1, 2]));
        },
        cancel(cancelReason) {
          cancelled.resolve(cancelReason);
        },
      }),
    );
    let requestSignal: AbortSignal | undefined;
    const create = vi.fn(
      async (_body: unknown, request?: { readonly signal?: AbortSignal }) => {
        requestSignal = request?.signal;
        return raw;
      },
    );
    const result = await createOpenAI(client(create)).streamSpeech({
      model: "gpt-4o-mini-tts",
      text: "Hello",
      abortSignal: controller.signal,
    });
    const reader = result.fullStream[Symbol.asyncIterator]();
    await expect(reader.next()).resolves.toMatchObject({
      value: { type: "start" },
    });
    await expect(reader.next()).resolves.toMatchObject({
      value: { type: "audio-delta", sequence: 0 },
    });
    const terminal = reader.next();

    controller.abort(reason);

    await expect(terminal).rejects.toBe(reason);
    await expect(result.completion).rejects.toBe(reason);
    expect(requestSignal?.reason).toBe(reason);
    await expect(cancelled.promise).resolves.toBe(reason);
    expect(raw.body?.locked).toBe(false);
  });

  it("rejects a missing body and native body failure without translation", async () => {
    const withoutBody = vi.fn(async () => new Response(null));
    const missing = await createOpenAI(client(withoutBody)).streamSpeech({
      model: "tts-1",
      text: "Hello",
    });
    const missingError = await collect(missing.fullStream).catch(
      (error: unknown) => error,
    );
    expect(missingError).toBeInstanceOf(TypeError);
    expect(missingError).toHaveProperty(
      "message",
      "OpenAI speech streaming requires a readable response body.",
    );
    await expect(missing.completion).rejects.toBe(missingError);

    const providerError = new Error("native body failed");
    const failingBody = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              stream.error(providerError);
            },
          }),
        ),
    );
    const failing = await createOpenAI(client(failingBody)).streamSpeech({
      model: "tts-1-hd",
      text: "Hello",
    });
    const failure = await collect(failing.fullStream).catch(
      (error: unknown) => error,
    );
    expect(failure).toBe(providerError);
    await expect(failing.completion).rejects.toBe(providerError);
  });
});

function responseWithChunks(chunks: readonly Uint8Array[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
  );
}

function client(create: ReturnType<typeof vi.fn>): OpenAI {
  return { audio: { speech: { create } } } as unknown as OpenAI;
}

async function dataBytes(
  asset:
    | Extract<SpeechStreamEvent, { readonly type: "audio" }>["audio"]
    | undefined,
): Promise<Uint8Array> {
  if (!asset || asset.type !== "data") {
    throw new Error("Expected inline audio bytes.");
  }
  return asset.data instanceof Uint8Array
    ? asset.data
    : new Uint8Array(await asset.data.arrayBuffer());
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
