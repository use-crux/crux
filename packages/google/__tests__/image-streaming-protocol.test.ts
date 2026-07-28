import { describe, expect, it } from "vitest";
import type { Interactions } from "@google/genai";
import { createGoogle } from "../src";
import {
  clientWith,
  clientWithResponse,
  collect,
  imageDelta,
  interactionCreated,
  interactionCompleted,
} from "./image-streaming.fixture";

describe("Google image streaming protocol", () => {
  it.each([
    {
      name: "a negative native step index",
      events: [
        interactionCreated,
        imageDelta(-1, "AQI=", "image/png"),
        interactionCompleted,
      ],
      message:
        "Google image stream step indexes must be non-negative safe integers.",
    },
    {
      name: "malformed base64",
      events: [
        interactionCreated,
        imageDelta(0, "not base64!", "image/png"),
        interactionCompleted,
      ],
      message: "Google image stream step 0 contains invalid base64 characters.",
    },
    {
      name: "a changed MIME type",
      events: [
        interactionCreated,
        imageDelta(0, "AQID", "image/png"),
        imageDelta(0, "BAUG", "image/webp"),
        interactionCompleted,
      ],
      message: "Google image stream step 0 changed MIME type between deltas.",
    },
    {
      name: "a missing first MIME type",
      events: [interactionCreated, imageDelta(0, "AQI="), interactionCompleted],
      message:
        "Google image stream step 0 must declare a MIME type on its first delta.",
    },
    {
      name: "missing image data",
      events: [
        interactionCreated,
        {
          event_type: "step.delta",
          index: 0,
          delta: { type: "image", mime_type: "image/png" },
        } satisfies Interactions.StepDelta,
        interactionCompleted,
      ],
      message: "Google image stream step 0 must contain non-empty base64 data.",
    },
    {
      name: "an incomplete terminal base64 group",
      events: [
        interactionCreated,
        imageDelta(0, "A", "image/png"),
        interactionCompleted,
      ],
      message:
        "Google image stream step 0 ended with an incomplete base64 group.",
    },
  ])("fails on $name", async ({ events, message }) => {
    const { client } = clientWith(events);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(TypeError);
    expect(error).toHaveProperty("message", message);
    await expect(result.completion).rejects.toBe(error);
  });

  it("fails when the current stream ends without a terminal event", async () => {
    const { client } = clientWith([
      interactionCreated,
      imageDelta(0, "AQI=", "image/png"),
    ]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      "Google image stream ended without an interaction.completed event.",
    );
    await expect(result.completion).rejects.toBe(error);
  });

  it("fails on a non-success terminal interaction", async () => {
    const failed = {
      ...interactionCompleted,
      interaction: {
        ...interactionCompleted.interaction,
        status: "failed",
      },
    } satisfies Interactions.InteractionCompletedEvent;
    const { client } = clientWith([
      interactionCreated,
      imageDelta(0, "AQI=", "image/png"),
      failed,
    ]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      'Google image interaction completed with status "failed".',
    );
    expect(error).toHaveProperty("cause", failed);
    await expect(result.completion).rejects.toBe(error);
  });

  it("skips unknown future events and non-image deltas", async () => {
    const future = {
      event_type: "interaction.future",
      opaque: true,
    } as unknown as Interactions.InteractionSSEEvent;
    const { client } = clientWith([
      interactionCreated,
      future,
      {
        event_type: "step.delta",
        index: 100,
        delta: { type: "text", text: "not image bytes" },
      },
      {
        event_type: "step.delta",
        index: 200,
        delta: { type: "future-delta", opaque: true },
      } as unknown as Interactions.StepDelta,
      imageDelta(7, "AQI=", "image/png"),
      interactionCompleted,
    ]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    await expect(result.completion).resolves.toMatchObject({
      raw: interactionCompleted,
    });
    expect(
      (await collect(result.fullStream)).filter(
        ({ type }) => type === "image-delta",
      ),
    ).toHaveLength(1);
  });

  it("fails if native events continue after the terminal envelope", async () => {
    const { client } = clientWith([
      interactionCreated,
      imageDelta(0, "AQI=", "image/png"),
      interactionCompleted,
      imageDelta(0, "AwQ=", "image/png"),
    ]);
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      "Google image stream emitted an event after interaction.completed.",
    );
    await expect(result.completion).rejects.toBe(error);
  });

  it("rejects a completed-only response instead of synthesizing deltas", async () => {
    const { client } = clientWithResponse({
      id: "interaction-1",
      status: "completed",
    });
    const result = await createGoogle(client, {
      cachedContent: false,
    }).streamImage({
      model: "gemini-3-pro-image",
      prompt: "x",
    });

    const error = await collect(result.fullStream).catch(
      (reason: unknown) => reason,
    );

    expect(error).toHaveProperty(
      "message",
      "Google image streaming requires an async iterable SDK response.",
    );
    await expect(result.completion).rejects.toBe(error);
  });
});
