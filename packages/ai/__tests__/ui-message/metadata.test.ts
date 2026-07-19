import type { StreamResult } from "@use-crux/core/adapter";
import {
  createCruxRunId,
  createCruxSpanId,
  createCruxTraceId,
} from "@use-crux/core/observability";
import { describe, expect, it, vi } from "vitest";
import { createUIMessageStreamResponse } from "../../src/ui-message";

describe("Crux UI-message metadata", () => {
  it("preserves user metadata while authoritatively stamping crux.runId", () => {
    const runId = createCruxRunId();
    const messageMetadata = vi.fn(() => ({
      user: { tenant: "acme" },
      crux: { feature: "support", runId: "user-supplied" },
    }));
    let emitted: unknown;
    const result = streamResult(runId, (options) => {
      emitted = options.messageMetadata?.({ part: { type: "start" } } as never);
    });

    createUIMessageStreamResponse(result, { messageMetadata });

    expect(messageMetadata).toHaveBeenCalledOnce();
    expect(emitted).toEqual({
      user: { tenant: "acme" },
      crux: { feature: "support", runId },
    });
  });

  it("adds Crux metadata when the user callback returns no metadata", () => {
    const runId = createCruxRunId();
    let emitted: unknown;
    const result = streamResult(runId, (options) => {
      emitted = options.messageMetadata?.({} as never);
    });

    createUIMessageStreamResponse(result, {
      messageMetadata: () => undefined,
    });

    expect(emitted).toEqual({ crux: { runId } });
  });

  it("stamps every lifecycle callback without changing callback frequency", () => {
    const runId = createCruxRunId();
    const messageMetadata = vi.fn(() => ({ source: "user" }));
    const emitted: unknown[] = [];
    const result = streamResult(runId, (options) => {
      emitted.push(options.messageMetadata?.({} as never));
      emitted.push(options.messageMetadata?.({} as never));
    });

    createUIMessageStreamResponse(result, { messageMetadata });

    expect(messageMetadata).toHaveBeenCalledTimes(2);
    expect(emitted).toEqual([
      { source: "user", crux: { runId } },
      { source: "user", crux: { runId } },
    ]);
  });
});

function streamResult(
  runId: ReturnType<typeof createCruxRunId>,
  inspect: (options: {
    readonly messageMetadata?: (input: { readonly part: never }) => unknown;
  }) => void,
): StreamResult<{ toUIMessageStream(options?: unknown): ReadableStream }> {
  const operation = {
    traceId: createCruxTraceId(),
    spanId: createCruxSpanId(),
  };
  return {
    runId,
    _meta: operation,
    textStream: (async function* () {})(),
    raw: {
      toUIMessageStream(options?: unknown) {
        inspect(
          options as {
            readonly messageMetadata?: (input: {
              readonly part: never;
            }) => unknown;
          },
        );
        return new ReadableStream({
          start(controller) {
            controller.close();
          },
        });
      },
    },
    completion: Promise.resolve({
      runId,
      _meta: operation,
      text: "",
      content: [],
      steps: [],
      finalStep: {
        content: [],
        text: "",
        finishReason: undefined,
        responseId: undefined,
        modelId: undefined,
        warnings: [],
      },
      messages: [],
      warnings: [],
    }),
  };
}
