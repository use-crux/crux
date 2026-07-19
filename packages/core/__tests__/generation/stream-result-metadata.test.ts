import { afterEach, describe, expect, it } from "vitest";

import {
  resetHooks,
  resetObservabilityRuntime,
} from "@use-crux/core";
import {
  createFakeAdapter,
  textPrompt,
} from "./stream-result-correlation.fixtures";

describe("managed stream completion metadata", () => {
  afterEach(() => {
    resetHooks();
    resetObservabilityRuntime();
  });

  it("keeps completion envelope fields out of provider-neutral metadata", async () => {
    const messages = [{ role: "assistant" as const, content: "Hello stream" }];
    const content = [{ type: "text" as const, text: "Hello stream" }];
    const result = await createFakeAdapter({
      completion: Promise.resolve({
        text: "Hello stream",
        content,
        messages,
        warnings: [{ code: "provider-warning" }],
        providerMetadata: { provider: "metadata" },
        responseId: "provider-stream-response",
        finishReason: "stop",
      }),
    }).stream(textPrompt, {
      model: "model-1",
      input: { message: "Hello" },
    });

    for await (const _chunk of result.textStream) {
      // Drain before observing the canonical completion.
    }
    const completion = await result.completion;

    expect(completion.messages).toEqual([{ role: "assistant", content }]);
    expect(completion.content).toEqual(content);
    expect(completion.warnings).toEqual([{ code: "provider-warning" }]);
    expect(completion.providerMetadata).toEqual({ provider: "metadata" });
    expect(completion._meta).toMatchObject({
      responseId: "provider-stream-response",
      finishReason: "stop",
      traceId: result._meta.traceId,
      spanId: result._meta.spanId,
    });
    expect(completion._meta).not.toHaveProperty("content");
    expect(completion._meta).not.toHaveProperty("messages");
    expect(completion._meta).not.toHaveProperty("warnings");
    expect(completion._meta).not.toHaveProperty("providerMetadata");
  });
});
