/**
 * Stateless UI-message helpers for canonical Crux stream results.
 *
 * These mirror AI SDK's response helpers while accepting Crux's
 * `{ textStream, raw, completion }` envelope. The raw AI SDK stream remains
 * the source of UI-message chunks.
 *
 * @module
 */

import {
  createUIMessageStreamResponse as createSdkUIMessageStreamResponse,
  pipeUIMessageStreamToResponse as pipeSdkUIMessageStreamToResponse,
  type UIMessage,
  type UIMessageStreamOptions,
} from "ai";
import type { StreamResult } from "@use-crux/core/adapter";
import type { CruxRunId } from "@use-crux/core/observability";

type SdkCreateOptions = Omit<
  Parameters<typeof createSdkUIMessageStreamResponse>[0],
  "stream"
>;
type SdkPipeOptions = Omit<
  Parameters<typeof pipeSdkUIMessageStreamToResponse>[0],
  "stream"
>;

/** Options for {@link createUIMessageStreamResponse}. */
export type CruxUIMessageStreamResponseOptions<
  UI_MESSAGE extends UIMessage = UIMessage,
> = SdkCreateOptions & UIMessageStreamOptions<UI_MESSAGE>;

/** Options for {@link pipeUIMessageStreamToResponse}. */
export type CruxPipeUIMessageStreamOptions<
  UI_MESSAGE extends UIMessage = UIMessage,
> = SdkPipeOptions & UIMessageStreamOptions<UI_MESSAGE>;

/**
 * Create an AI SDK UI-message `Response` from a Crux stream result.
 *
 * @param result - A canonical `stream()` result from `@use-crux/ai`.
 * @param options - AI SDK UI-message and response options.
 * @returns An SSE `Response` suitable for `useChat` transports.
 */
export function createUIMessageStreamResponse<
  UI_MESSAGE extends UIMessage = UIMessage,
>(
  result: StreamResult<unknown>,
  options: CruxUIMessageStreamResponseOptions<UI_MESSAGE> = {},
): Response {
  return createSdkUIMessageStreamResponse({
    ...options,
    stream: toUIMessageStream(result, options),
  });
}

/**
 * Pipe an AI SDK UI-message stream from a Crux stream result into a Node
 * `ServerResponse`.
 *
 * @param result - A canonical `stream()` result from `@use-crux/ai`.
 * @param options - AI SDK UI-message, response, and Node response options.
 */
export function pipeUIMessageStreamToResponse<
  UI_MESSAGE extends UIMessage = UIMessage,
>(
  result: StreamResult<unknown>,
  options: CruxPipeUIMessageStreamOptions<UI_MESSAGE>,
): void {
  pipeSdkUIMessageStreamToResponse({
    ...options,
    stream: toUIMessageStream(result, options),
  });
}

function toUIMessageStream<UI_MESSAGE extends UIMessage>(
  result: StreamResult<unknown>,
  options: UIMessageStreamOptions<UI_MESSAGE>,
) {
  const raw = result.raw as {
    toUIMessageStream?: (
      options?: UIMessageStreamOptions<UI_MESSAGE>,
    ) => ReadableStream;
  };
  if (typeof raw.toUIMessageStream !== "function") {
    throw new TypeError(
      "@use-crux/ai UI-message helpers require an AI SDK text stream result with toUIMessageStream().",
    );
  }
  return raw.toUIMessageStream(withCruxMessageMetadata(options, result.runId));
}

function withCruxMessageMetadata<UI_MESSAGE extends UIMessage>(
  options: UIMessageStreamOptions<UI_MESSAGE>,
  runId: CruxRunId,
): UIMessageStreamOptions<UI_MESSAGE> {
  const userMessageMetadata = options.messageMetadata;
  return {
    ...options,
    messageMetadata: (input) =>
      mergeCruxMetadata(userMessageMetadata?.(input), runId) as ReturnType<
        NonNullable<UIMessageStreamOptions<UI_MESSAGE>["messageMetadata"]>
      >,
  };
}

function mergeCruxMetadata(value: unknown, runId: CruxRunId): unknown {
  const metadata = isRecord(value) ? value : {};
  const crux = isRecord(metadata.crux) ? metadata.crux : {};
  return {
    ...metadata,
    crux: { ...crux, runId },
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
