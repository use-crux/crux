import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type OpenAI from "openai";
import { imageGenerationConformanceRow } from "@use-crux/core/adapter/testing";
import { fallback } from "@use-crux/core";
import { boundary, guardrail } from "@use-crux/core/safety";
import { createOpenAI } from "../src";

function clientWith(response: unknown) {
  const generate = vi.fn(
    async (_args: unknown, _options?: unknown) => response,
  );
  const edit = vi.fn(async (_args: unknown, _options?: unknown) => response);
  return {
    client: { images: { generate, edit } } as unknown as OpenAI,
    generate,
    edit,
  };
}

describe("OpenAI image generation", () => {
  it("guards image options without leaking policy controls into OpenAI", async () => {
    const raw = { created: 1, data: [{ b64_json: "AQI=" }] };
    const { client, generate } = clientWith(raw);
    const result = await createOpenAI(client).generateImage({
      model: "gpt-image-1",
      prompt: "private prompt",
      guardrails: [
        guardrail({
          id: "openai-image-input",
          on: boundary.input.user(),
          run: () => ({
            action: "rewrite",
            value: "guarded prompt",
            rewrite: { kind: "redact" },
          }),
        }),
        guardrail({
          id: "openai-image-output",
          on: boundary.output.media(),
          run: () => ({ action: "warn", reason: "Review image." }),
        }),
      ],
      safety: { tune: { "openai-image-output": { mode: "report" } } },
    });

    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      prompt: "guarded prompt",
    });
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty("guardrails");
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty("safety");
    expect(result.raw).toBe(raw);
    expect(
      result.safety?.guardrails?.applied.map((entry) => entry.guard),
    ).toEqual(["openai-image-input", "openai-image-output"]);
  });

  it("accepts routing wrappers and sends only the selected leaf model", async () => {
    const { client, generate } = clientWith({
      created: 1,
      data: [{ b64_json: "AQI=" }],
    });
    await createOpenAI(client).generateImage({
      model: fallback(["gpt-image-1", "dall-e-2"]),
      prompt: "x",
    });
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ model: "gpt-image-1" });
  });

  it("performs exactly one native image generation and preserves the raw result", async () => {
    expect(imageGenerationConformanceRow("openai").support).toBe("native");
    const raw = {
      created: 1,
      output_format: "webp",
      data: [{ b64_json: "AQI=" }, { b64_json: "AwQ=" }],
      usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
    };
    const { client, generate, edit } = clientWith(raw);
    const openai = createOpenAI(client);

    const result = await openai.generateImage({
      model: "gpt-image-1",
      prompt: "A quiet canal",
      n: 2,
      size: "1024x1024",
      extra: { quality: "high", output_format: "webp" },
    });

    expect(generate).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(
      {
        model: "gpt-image-1",
        prompt: "A quiet canal",
        n: 2,
        size: "1024x1024",
        response_format: "b64_json",
        quality: "high",
        output_format: "webp",
        stream: false,
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(result.raw).toBe(raw);
    expect(result.image).toBe(result.images[0]);
    expect(result.images.map((image) => image.mediaType)).toEqual([
      "image/webp",
      "image/webp",
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.execution).toEqual({ kind: "native", calls: 1 });
    expect(result).not.toHaveProperty("usage");
    expect(Object.hasOwn(result, "persist")).toBe(false);
    expectTypeOf(openai.generateImage).toBeFunction();
  });

  it("uses the native edit operation for byte references and a mask", async () => {
    const { client, generate, edit } = clientWith({
      created: 1,
      data: [{ b64_json: "AQI=" }],
    });
    const openai = createOpenAI(client);
    const image = {
      type: "data" as const,
      data: new Uint8Array([1]),
      mediaType: "image/png",
    };

    await openai.generateImage({
      model: "gpt-image-1",
      prompt: { text: "Remove the boat", images: [image], mask: image },
    });

    expect(edit).toHaveBeenCalledOnce();
    expect(generate).not.toHaveBeenCalled();
    expect(edit.mock.calls[0]?.[0]).toMatchObject({
      model: "gpt-image-1",
      prompt: "Remove the boat",
      stream: false,
    });
    expect(edit.mock.calls[0]?.[1]).toEqual({
      signal: expect.any(AbortSignal),
    });
  });

  it("fails unsupported features before touching the OpenAI client", async () => {
    const { client, generate, edit } = clientWith({ created: 1, data: [] });
    const openai = createOpenAI(client);

    await expect(
      openai.generateImage({
        model: "gpt-image-1",
        prompt: {
          text: "Edit this",
          images: [
            {
              type: "url",
              url: new URL("https://example.com/a.png"),
              mediaType: "image/png",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "unsupported_capability" });
    expect(generate).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
  });

  it("propagates native errors unchanged and only translates no-image successes", async () => {
    const providerError = new Error("provider failed");
    const failing = clientWith(undefined);
    failing.generate.mockRejectedValueOnce(providerError);
    await expect(
      createOpenAI(failing.client).generateImage({
        model: "gpt-image-1",
        prompt: "x",
      }),
    ).rejects.toBe(providerError);

    const empty = clientWith({ created: 1, data: [] });
    await expect(
      createOpenAI(empty.client).generateImage({
        model: "gpt-image-1",
        prompt: "x",
      }),
    ).rejects.toMatchObject({
      code: "no_image_generated",
    });
  });
});
