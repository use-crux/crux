import { describe, expect, it, vi } from "vitest";
import { adapter } from "../../src/adapter/define-adapter";
import type { AdapterSpec } from "../../src/adapter/spec";
import type { AdapterResponse } from "../../src/adapter/types";
import type { Message } from "../../src/generation/messages";
import { prompt } from "../../src/prompt/prompt";
import { boundary, constraint } from "../../src/safety";

describe("corrective media normalization", () => {
  it("normalizes raw Blob media immediately before every provider call", async () => {
    const source = new Blob([new Uint8Array([1, 2, 3])], {
      type: "image/png",
    });
    const read = vi.spyOn(source, "arrayBuffer");
    const calls: Message[][] = [];
    const responses = ["no boats", "a ship!"];
    const spec: AdapterSpec<{ readonly kind: "mock" }, { readonly raw: true }, never> = {
      providerId: "mock",
      async call(_client, args) {
        calls.push(args.messages);
        const text = responses.shift() ?? "a ship!";
        const extracted: AdapterResponse = {
          text,
          finishReason: "stop",
        };
        return { raw: { raw: true }, extracted };
      },
      async stream() {
        throw new Error("not used");
      },
      appendToolRound(messages) {
        return messages;
      },
      mapSettings(settings) {
        return { ...settings };
      },
    };
    const runtime = adapter(spec)({ kind: "mock" });

    await runtime.generate(prompt({ id: "corrective-media", prompt: "write" }), {
      model: "mock-model",
      messages: [
        {
          role: "user",
          content: [{ type: "image", source }],
        },
      ],
      constraints: [
        constraint({
          id: "mentions-ship",
          on: boundary.output.both(),
          run: async (output) =>
            output.text.includes("ship")
              ? { pass: true as const }
              : { pass: false as const, feedback: "must mention ship" },
        }),
      ],
    });

    expect(calls).toHaveLength(2);
    expect(read).toHaveBeenCalledTimes(2);
    for (const messages of calls) {
      const image = messages
        .flatMap((message) =>
          Array.isArray(message.content) ? message.content : [],
        )
        .find((part) => part.type === "image");
      expect(image).toMatchObject({
        source: {
          type: "data",
          data: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
        },
      });
    }
  });
});
