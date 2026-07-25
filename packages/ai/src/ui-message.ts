/**
 * UI-message helpers built from the logical stream (RFC #173).
 *
 * These translate Crux's logical `start`/content/`finish` events into the AI SDK
 * UI protocol. They are deliberately built from `fullStream` rather than from a
 * provider result: a discarded attempt is unrepresentable in their input, so a
 * rejected attempt's text can never reach a rendered message, and they never
 * wait for an accepted provider object before emitting.
 *
 * The logical `finish` event carries the finish reason and aggregate usage the
 * terminal UI part needs, so the translation closes from that event instead of
 * separately awaiting `completion`. Facts the UI protocol does not represent
 * stay available on `completion`.
 *
 * @module
 */

import {
  createUIMessageStreamResponse as createSdkUIMessageStreamResponse,
  createTextStreamResponse as createSdkTextStreamResponse,
  pipeUIMessageStreamToResponse as pipeSdkUIMessageStreamToResponse,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamOptions,
} from "ai";
import type { StreamEvent, StreamResult } from "@use-crux/core/adapter";
import type { ContentPart } from "@use-crux/core";
import type { CruxRunId } from "@use-crux/core/observability";

type SdkCreateOptions = Omit<
  Parameters<typeof createSdkUIMessageStreamResponse>[0],
  "stream"
>;
type SdkPipeOptions = Omit<
  Parameters<typeof pipeSdkUIMessageStreamToResponse>[0],
  "stream"
>;
type SdkTextResponseOptions = Omit<
  Parameters<typeof createSdkTextStreamResponse>[0],
  "textStream"
>;

/** Options for {@link createUIMessageStreamResponse}. */
export type CruxUIMessageStreamResponseOptions<
  UI_MESSAGE extends UIMessage = UIMessage,
> = SdkCreateOptions & UIMessageStreamOptions<UI_MESSAGE>;

/** Options for {@link pipeUIMessageStreamToResponse}. */
export type CruxPipeUIMessageStreamOptions<
  UI_MESSAGE extends UIMessage = UIMessage,
> = SdkPipeOptions & UIMessageStreamOptions<UI_MESSAGE>;

/** Options for {@link createTextStreamResponse}. */
export type CruxTextStreamResponseOptions = SdkTextResponseOptions;

/**
 * Translate a Crux logical stream into an AI SDK UI-message chunk stream.
 *
 * @param result - A canonical `stream()` result from `@use-crux/ai`.
 * @param options - AI SDK UI-message options.
 * @returns A UI-message chunk stream suitable for `useChat` transports.
 */
export function toUIMessageStream<UI_MESSAGE extends UIMessage = UIMessage>(
  result: StreamResult<unknown, unknown>,
  options: UIMessageStreamOptions<UI_MESSAGE> = {},
): ReadableStream<UIMessageChunk> {
  const metadata = messageMetadataFor(options, result.runId);
  const sendReasoning = options.sendReasoning ?? true;
  const sendSources = options.sendSources ?? false;
  const sendFinish = options.sendFinish ?? true;
  const sendStart = options.sendStart ?? true;
  // One synthetic block per kind spans the logical stream: Crux does not publish
  // physical text-block framing, so the UI protocol's block boundaries are
  // derived here rather than forwarded from a provider. Text and reasoning need
  // DISTINCT ids — sharing one would merge a private reasoning trace into the
  // rendered answer.
  const textId = `${result.runId}-text`;
  const reasoningId = `${result.runId}-reasoning`;
  let textOpen = false;
  let reasoningOpen = false;

  const events = result.fullStream[Symbol.asyncIterator]();
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      for (;;) {
        const next = await events.next();
        if (next.done) {
          controller.close();
          return;
        }
        const chunks = await translate(next.value as StreamEvent<unknown>, {
          textId,
          reasoningId,
          sendReasoning,
          sendSources,
          sendStart,
          sendFinish,
          metadata,
          openText: () => {
            const wasOpen = textOpen;
            textOpen = true;
            return wasOpen;
          },
          closeText: () => {
            const wasOpen = textOpen;
            textOpen = false;
            return wasOpen;
          },
          openReasoning: () => {
            const wasOpen = reasoningOpen;
            reasoningOpen = true;
            return wasOpen;
          },
          closeReasoning: () => {
            const wasOpen = reasoningOpen;
            reasoningOpen = false;
            return wasOpen;
          },
        });
        if (chunks.length === 0) continue;
        for (const chunk of chunks) controller.enqueue(chunk);
        return;
      }
    },
    async cancel(reason) {
      await events.return?.(reason);
    },
  });
}

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
  result: StreamResult<unknown, unknown>,
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
  result: StreamResult<unknown, unknown>,
  options: CruxPipeUIMessageStreamOptions<UI_MESSAGE>,
): void {
  pipeSdkUIMessageStreamToResponse({
    ...options,
    stream: toUIMessageStream(result, options),
  });
}

/**
 * Create a plain-text `Response` from a Crux stream result.
 *
 * @remarks
 * For a STRUCTURED prompt this intentionally streams the canonical serialized
 * `z.input` JSON, which is exactly what `textStream` publishes — not a provider
 * wire representation and not a rendered summary.
 */
export function createTextStreamResponse(
  result: StreamResult<unknown, unknown>,
  options: CruxTextStreamResponseOptions = {},
): Response {
  return createSdkTextStreamResponse({
    ...options,
    textStream: result.textStream,
  });
}

interface TranslateContext {
  readonly textId: string;
  readonly reasoningId: string;
  readonly sendReasoning: boolean;
  readonly sendSources: boolean;
  readonly sendStart: boolean;
  readonly sendFinish: boolean;
  /** Invoke the caller's metadata callback with the part being emitted. */
  readonly metadata: (part: Record<string, unknown>) => unknown;
  /** Mark the text block open; returns whether it already was. */
  openText(): boolean;
  /** Mark the text block closed; returns whether it was open. */
  closeText(): boolean;
  /** Mark the reasoning block open; returns whether it already was. */
  openReasoning(): boolean;
  /** Mark the reasoning block closed; returns whether it was open. */
  closeReasoning(): boolean;
}

async function translate(
  event: StreamEvent<unknown>,
  context: TranslateContext,
): Promise<readonly UIMessageChunk[]> {
  switch (event.type) {
    case "start": {
      if (!context.sendStart) return [];
      const metadata = context.metadata({ type: "start" });
      return [
        {
          type: "start",
          ...(metadata !== undefined ? { messageMetadata: metadata } : {}),
        } as UIMessageChunk,
      ];
    }
    case "text-delta": {
      const chunks: UIMessageChunk[] = [];
      if (!context.openText()) {
        chunks.push({ type: "text-start", id: context.textId } as UIMessageChunk);
      }
      chunks.push({
        type: "text-delta",
        id: context.textId,
        delta: event.text,
      } as UIMessageChunk);
      return chunks;
    }
    case "reasoning-delta": {
      if (!context.sendReasoning) return [];
      const chunks: UIMessageChunk[] = [];
      // The protocol requires an explicit block start before any delta.
      if (!context.openReasoning()) {
        chunks.push({
          type: "reasoning-start",
          id: context.reasoningId,
        } as UIMessageChunk);
      }
      chunks.push({
        type: "reasoning-delta",
        id: context.reasoningId,
        delta: event.text,
      } as UIMessageChunk);
      return chunks;
    }
    case "tool-call":
      return [
        {
          type: "tool-input-available",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        } as UIMessageChunk,
      ];
    case "tool-result":
      return [
        event.isError
          ? ({
              type: "tool-output-error",
              toolCallId: event.toolCallId,
              errorText: String(event.output),
            } as UIMessageChunk)
          : ({
              type: "tool-output-available",
              toolCallId: event.toolCallId,
              output: event.output,
            } as UIMessageChunk),
      ];
    case "media": {
      const chunk = await fileChunk(event.part);
      return chunk ? [chunk] : [];
    }
    case "source":
      return context.sendSources
        ? [
            event.source.kind === "url"
              ? ({
                  type: "source-url",
                  sourceId: event.source.id,
                  url: event.source.url,
                  ...(event.source.title !== undefined
                    ? { title: event.source.title }
                    : {}),
                } as UIMessageChunk)
              : ({
                  type: "source-document",
                  sourceId: event.source.id,
                  mediaType: event.source.mediaType,
                  title: event.source.title,
                  ...(event.source.filename !== undefined
                    ? { filename: event.source.filename }
                    : {}),
                } as UIMessageChunk),
          ]
        : [];
    case "finish": {
      const chunks: UIMessageChunk[] = [];
      if (context.closeReasoning()) {
        chunks.push({
          type: "reasoning-end",
          id: context.reasoningId,
        } as UIMessageChunk);
      }
      if (context.closeText()) {
        chunks.push({ type: "text-end", id: context.textId } as UIMessageChunk);
      }
      if (!context.sendFinish) return chunks;
      // The logical `finish` carries the operation's finish reason and aggregate
      // usage. Forward BOTH to the caller's metadata callback: a caller migrating
      // from the SDK helper reads `part.totalUsage` there, and silently handing
      // them `undefined` would look like a provider that reported nothing.
      const finishPart = {
        type: "finish" as const,
        ...(event.finishReason !== undefined
          ? { finishReason: event.finishReason }
          : {}),
        ...(event.usage !== undefined ? { totalUsage: event.usage } : {}),
      };
      const metadata = context.metadata(finishPart);
      chunks.push({
        ...finishPart,
        ...(metadata !== undefined ? { messageMetadata: metadata } : {}),
      } as UIMessageChunk);
      return chunks;
    }
    // `partial-output` and `tool-approval-request` have no UI-protocol
    // representation. They stay reachable on `fullStream` and `completion` rather
    // than being forced into a chunk shape that would misdescribe them.
    default:
      return [];
  }
}

/**
 * Render published media as a UI `file` chunk.
 *
 * @returns `undefined` when the part carries no inline bytes or resolvable URL —
 *   a provider-hosted file reference cannot be rendered without fetching it, and
 *   emitting a chunk with no usable `url` would render as a broken attachment.
 */
async function fileChunk(
  part: Exclude<ContentPart, { readonly type: "text" }>,
): Promise<UIMessageChunk | undefined> {
  const url = await mediaUrl(part.source, part.mediaType);
  return url
    ? ({
        type: "file",
        url,
        mediaType: part.mediaType ?? "application/octet-stream",
      } as UIMessageChunk)
    : undefined;
}

async function mediaUrl(
  source: unknown,
  mediaType: string | undefined,
): Promise<string | undefined> {
  if (typeof source === "string") return source;
  if (source instanceof URL) return source.href;
  if (source instanceof Uint8Array) return dataUrl(source, mediaType);
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return dataUrl(
      new Uint8Array(await source.arrayBuffer()),
      source.type || mediaType,
    );
  }
  if (isRecord(source)) {
    if (source.type === "url" && source.url instanceof URL) {
      return source.url.href;
    }
    if (source.type === "data" && source.data instanceof Uint8Array) {
      return dataUrl(
        source.data,
        typeof source.mediaType === "string" ? source.mediaType : mediaType,
      );
    }
  }
  return undefined;
}

function dataUrl(bytes: Uint8Array, mediaType: string | undefined): string {
  const type = mediaType ?? "application/octet-stream";
  return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** Merge the Crux run id into whatever message metadata the caller supplies. */
function messageMetadataFor<UI_MESSAGE extends UIMessage>(
  options: UIMessageStreamOptions<UI_MESSAGE>,
  runId: CruxRunId,
): (part: Record<string, unknown>) => unknown {
  const provided = options.messageMetadata as
    | ((input: { part: unknown }) => unknown)
    | undefined;
  return (part) => {
    const value = provided?.({ part });
    const metadata = isRecord(value) ? value : {};
    const crux = isRecord(metadata.crux) ? metadata.crux : {};
    return { ...metadata, crux: { ...crux, runId } };
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
