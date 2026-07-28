import { describe, expect, expectTypeOf, it } from "vitest";
import type { Interactions } from "@google/genai";
import type { Asset, ImageStreamEvent } from "@use-crux/core";
import {
  createGoogle,
  type GoogleStreamImage,
  type GoogleStreamImageResult,
} from "../src";
import {
  cancellableClient,
  clientWith,
  collect,
  imageDelta,
  interactionCreated,
  interactionCompleted,
  sparseInterleavedEvents,
  waitFor,
} from "./image-streaming.fixture";

describe("Google image streaming", () => {
  it("maps current image deltas to dense outputs and preserves the exact terminal event", async () => {
    const { client, create } = clientWith(sparseInterleavedEvents);
    const google = createGoogle(client, { cachedContent: false });

    const result = await google.streamImage({
      model: "gemini-3.1-flash-image",
      prompt: "A quiet canal",
    });
    const events = await collect(result.fullStream);
    const completion = await result.completion;

    expectTypeOf(google.streamImage).toBeFunction();
    expectTypeOf(result).toMatchTypeOf<GoogleStreamImageResult>();
    expectTypeOf<GoogleStreamImage>().toBeFunction();
    expectTypeOf(result.fullStream).toMatchTypeOf<
      AsyncIterable<ImageStreamEvent>
    >();
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(
      {
        api_version: "v1beta",
        model: "gemini-3.1-flash-image",
        input: "A quiet canal",
        response_format: { type: "image" },
        store: false,
        stream: true,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-delta",
      "image-delta",
      "image-delta",
      "image",
      "image",
      "finish",
    ]);
    const deltas = events.filter(
      (
        event: ImageStreamEvent,
      ): event is Extract<ImageStreamEvent, { readonly type: "image-delta" }> =>
        event.type === "image-delta",
    );
    expect(
      deltas.map(({ outputIndex, sequence, mediaType, data }) => ({
        outputIndex,
        sequence,
        mediaType,
        data: [...data],
      })),
    ).toEqual([
      {
        outputIndex: 0,
        sequence: 0,
        mediaType: "image/png",
        data: [1, 2, 3],
      },
      {
        outputIndex: 1,
        sequence: 0,
        mediaType: "image/webp",
        data: [7, 8],
      },
      {
        outputIndex: 0,
        sequence: 1,
        mediaType: "image/png",
        data: [4, 5, 6],
      },
    ]);
    expect(completion.raw).toBe(interactionCompleted);
    expect(completion.raw.interaction.usage).toBe(
      interactionCompleted.interaction.usage,
    );
    expect(completion.images).toHaveLength(2);
    expect(completion.warnings).toEqual([]);
    const finals = events.filter(
      (
        event: ImageStreamEvent,
      ): event is Extract<ImageStreamEvent, { readonly type: "image" }> =>
        event.type === "image",
    );
    expect(finals.map(({ outputIndex }) => outputIndex)).toEqual([0, 1]);
    expect(finals.map(({ image }) => image)).toEqual(completion.images);
    await expect(bytes(completion.images[0])).resolves.toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    await expect(bytes(completion.images[1])).resolves.toEqual([7, 8]);
  });

  it("flushes a short terminal base64 group as a final append-only delta", async () => {
    const terminal = {
      ...interactionCompleted,
      interaction: { ...interactionCompleted.interaction, id: "split" },
    } satisfies Interactions.InteractionCompletedEvent;
    const created = {
      ...interactionCreated,
      interaction: { ...interactionCreated.interaction, id: "split" },
    } satisfies Interactions.InteractionCreatedEvent;
    const { client } = clientWith([
      created,
      imageDelta(41, "A", "image/png"),
      imageDelta(41, "QI"),
      terminal,
    ]);

    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-2.5-flash-image",
      prompt: "x",
    });
    const events = await collect(result.fullStream);

    expect(
      events
        .filter(
          (
            event,
          ): event is Extract<
            ImageStreamEvent,
            { readonly type: "image-delta" }
          > => event.type === "image-delta",
        )
        .map(({ outputIndex, sequence, data }) => ({
          outputIndex,
          sequence,
          data: [...data],
        })),
    ).toEqual([{ outputIndex: 0, sequence: 0, data: [1, 2] }]);
    await expect(bytes((await result.completion).image)).resolves.toEqual([
      1, 2,
    ]);
  });

  it("rejects unsupported stream capabilities before SDK I/O", async () => {
    const reference = {
      type: "data",
      data: new Uint8Array([1]),
      mediaType: "image/png",
    } as const;
    const cases = [
      { model: "gemini-3-pro-image-preview", prompt: "x" },
      { model: "gemini-3.1-flash-image-preview", prompt: "x" },
      { model: "gemini-2.0-flash", prompt: "x" },
      { model: "gemini-3-pro-image", prompt: "x", n: 2 },
      { model: "gemini-3-pro-image", prompt: "x", size: "1024x1024" },
      { model: "gemini-3-pro-image", prompt: "x", aspectRatio: "1:1" },
      { model: "gemini-3-pro-image", prompt: "x", seed: 7 },
      {
        model: "gemini-3-pro-image",
        prompt: { text: "edit", images: [reference] },
      },
      { model: "gemini-3-pro-image", prompt: "x", extra: {} },
    ] as const;

    for (const options of cases) {
      const { client, create } = clientWith([interactionCompleted]);
      await expect(
        createGoogle(client, { cachedContent: false }).streamImage(
          options as never,
        ),
      ).rejects.toMatchObject({ code: "unsupported_capability" });
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("propagates caller abort through the SDK source with exact identity", async () => {
    const reason = new Error("caller stopped");
    const controller = new AbortController();
    const fixture = cancellableClient([
      interactionCreated,
      imageDelta(7, "AQID", "image/png"),
    ]);
    const result = await createGoogle(fixture.client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
      abortSignal: controller.signal,
    });
    const reader = collect(result.fullStream).catch((error: unknown) => error);
    await waitFor(
      () => fixture.requestSignal() !== undefined,
      "Google stream was not opened.",
    );

    controller.abort(reason);

    expect(await reader).toBe(reason);
    await expect(result.completion).rejects.toBe(reason);
    expect(fixture.requestSignal()?.reason).toBe(reason);
    await expect(fixture.returned).resolves.toBeUndefined();
  });
});

async function bytes(image: Asset | undefined): Promise<number[]> {
  if (!image || image.type !== "data") throw new Error("Expected data image.");
  const data =
    image.data instanceof Uint8Array
      ? image.data
      : new Uint8Array(await image.data.arrayBuffer());
  return [...data];
}
