import { describe, expect, expectTypeOf, it } from "vitest";
import type { ImagesResponse } from "openai/resources/images";
import type { ImageStreamEvent } from "@use-crux/core";
import {
  createOpenAI,
  type OpenAIStreamImage,
  type OpenAIStreamImageResult,
} from "../src";
import {
  cancellableClient,
  clientWith,
  clientWithResponse,
  collect,
  completed,
  dataBytes,
  firstPreview,
  partialImage,
  secondPreview,
  waitFor,
} from "./image-streaming.fixture";

describe("OpenAI image streaming", () => {
  it("maps native complete previews and the exact final event", async () => {
    const { client, generate } = clientWith([
      firstPreview,
      secondPreview,
      completed,
    ]);
    const openai = createOpenAI(client);

    const result = await openai.streamImage({
      model: "gpt-image-2",
      prompt: "A quiet canal",
      n: 1,
      extra: {
        partial_images: 2,
        output_format: "webp",
        quality: "high",
      },
    });
    const events = await collect(result.fullStream);
    const completion = await result.completion;

    expectTypeOf(openai.streamImage).toBeFunction();
    expectTypeOf(result).toMatchTypeOf<OpenAIStreamImageResult>();
    expectTypeOf<OpenAIStreamImage>().toBeFunction();
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(
      {
        model: "gpt-image-2",
        n: 1,
        prompt: "A quiet canal",
        partial_images: 2,
        output_format: "webp",
        quality: "high",
        stream: true,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(events.map(({ type }) => type)).toEqual([
      "start",
      "image-preview",
      "image-preview",
      "image",
      "finish",
    ]);
    const previews = events.filter(
      (
        event,
      ): event is Extract<
        ImageStreamEvent,
        { readonly type: "image-preview" }
      > => event.type === "image-preview",
    );
    expect(
      previews.map(({ outputIndex, sequence }) => ({ outputIndex, sequence })),
    ).toEqual([
      { outputIndex: 0, sequence: 0 },
      { outputIndex: 0, sequence: 1 },
    ]);
    expect([...dataBytes(previews[0]?.image)]).toEqual([1, 2]);
    expect([...dataBytes(previews[1]?.image)]).toEqual([3, 4]);

    expect(completion.raw).toBe(completed);
    expect(completion.raw.usage).toBe(completed.usage);
    expect(completion.warnings).toEqual([]);
    expect(completion.providerMetadata).toEqual({
      background: completed.background,
      created_at: completed.created_at,
      output_format: completed.output_format,
      quality: completed.quality,
      size: completed.size,
      usage: completed.usage,
    });
    expect(completion).not.toHaveProperty("revised_prompt");
    expect(completion.raw).not.toHaveProperty("revised_prompt");
    const final = events.find(
      (event): event is Extract<ImageStreamEvent, { readonly type: "image" }> =>
        event.type === "image",
    );
    expect(final?.outputIndex).toBe(0);
    expect(final?.image).toBe(completion.image);
    expect([...dataBytes(completion.image)]).toEqual([5, 6]);
  });

  it("rejects multiple outputs during preflight without SDK I/O", async () => {
    const { client, generate } = clientWith([completed]);

    await expect(
      createOpenAI(client).streamImage({
        model: "gpt-image-2",
        prompt: "Two quiet canals",
        n: 2,
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a non-monotonic native preview sequence", async () => {
    const { client } = clientWith([
      partialImage(0, "AQI="),
      partialImage(0, "AwQ="),
      completed,
    ]);
    const result = await createOpenAI(client).streamImage({
      model: "gpt-image-2",
      prompt: "A quiet canal",
      extra: { partial_images: 2 },
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty(
      "message",
      "OpenAI image preview indexes must increase monotonically.",
    );
    await expect(result.completion).rejects.toBe(error);
  });

  it("propagates caller abort through the SDK source with exact identity", async () => {
    const reason = new Error("caller stopped");
    const controller = new AbortController();
    const fixture = cancellableClient([firstPreview]);
    const result = await createOpenAI(fixture.client).streamImage({
      model: "gpt-image-2",
      prompt: "A quiet canal",
      abortSignal: controller.signal,
      extra: { partial_images: 1 },
    });
    const reader = collect(result.fullStream).catch((error: unknown) => error);
    await waitFor(
      () => fixture.requestSignal() !== undefined,
      "OpenAI stream was not opened.",
    );

    controller.abort(reason);

    expect(await reader).toBe(reason);
    await expect(result.completion).rejects.toBe(reason);
    expect(fixture.requestSignal()?.reason).toBe(reason);
    await expect(fixture.returned).resolves.toBeUndefined();
  });

  it("rejects unsupported native stream shapes before SDK I/O", async () => {
    const cases = [
      { model: "dall-e-3", prompt: "x" },
      { model: "gpt-image-2", prompt: "x", aspectRatio: "1:1" },
      { model: "gpt-image-2", prompt: "x", seed: 7 },
      {
        model: "gpt-image-2",
        prompt: {
          text: "edit",
          images: [
            {
              type: "data",
              data: new Uint8Array([1]),
              mediaType: "image/png",
            },
          ],
        },
      },
      {
        model: "gpt-image-2",
        prompt: "x",
        extra: { input_fidelity: "high" },
      },
    ] as const;

    for (const options of cases) {
      const { client, generate } = clientWith([completed]);
      await expect(
        createOpenAI(client).streamImage(options),
      ).rejects.toMatchObject({ code: "unsupported_capability" });
      expect(generate).not.toHaveBeenCalled();
    }
  });

  it("validates the native preview count before SDK I/O", async () => {
    const { client, generate } = clientWith([completed]);

    await expect(
      createOpenAI(client).streamImage({
        model: "gpt-image-2",
        prompt: "x",
        extra: { partial_images: 4 as 3 },
      }),
    ).rejects.toThrow(
      "OpenAI image streaming extra.partial_images must be an integer from 0 to 3.",
    );
    expect(generate).not.toHaveBeenCalled();
  });

  it("never slices a completed-only image response into synthetic events", async () => {
    const response = {
      created: 1,
      data: [{ b64_json: "AQI=" }],
    } satisfies ImagesResponse;
    const { client } = clientWithResponse(response);
    const result = await createOpenAI(client).streamImage({
      model: "gpt-image-2",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty(
      "message",
      "OpenAI image streaming requires an async iterable SDK response.",
    );
    await expect(result.completion).rejects.toBe(error);
  });
});
