/**
 * Payload-free observability for bounded media streams.
 *
 * Every method accepts closed scalar descriptors. Canonical events, results,
 * assets, prompts, native events, and provider reports cannot cross this
 * boundary.
 *
 * @module
 * @internal
 */

import type { CompletedOperationReport } from "../completed-operation/report";
import { classifyError } from "../../generation/fallback";
import { TimeoutError } from "../../generation/timeout";
import {
  observe,
  type CruxRunId,
  type CruxSpanId,
  type CruxTraceId,
  type OpenObservedSpan,
} from "../../observability";
import { markErrorForObservation } from "../../observability/error-projection";

export type StreamingTerminal = "ok" | "error" | "cancelled" | "timeout";

/** One payload-free canonical progress occurrence. */
export interface StreamingEventDescriptor {
  readonly kind: "preview" | "delta" | "final";
  readonly byteCount: number;
  readonly mediaType?: string;
}

/** Safe identity for one physical provider attempt. */
export interface StreamingAttemptDescriptor {
  readonly model: string;
}

/** Safe success facts discovered after route acceptance. */
export interface StreamingSuccessDescriptor {
  readonly model: string;
  readonly calls: number;
  readonly attemptCount: number;
  readonly report?: CompletedOperationReport;
}

export interface StreamingAttemptObservation {
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>;
  candidate(event: StreamingEventDescriptor): void;
  published(): void;
  succeed(): void;
  fail(error: unknown, terminal: Exclude<StreamingTerminal, "ok">): void;
}

export interface StreamingOperationObservation {
  readonly runId: CruxRunId;
  readonly traceId: CruxTraceId;
  readonly spanId: CruxSpanId;
  withContext<T>(fn: () => T | Promise<T>): T | Promise<T>;
  startAttempt(
    descriptor: StreamingAttemptDescriptor,
  ): StreamingAttemptObservation;
  published(event: StreamingEventDescriptor): void;
  succeed(descriptor: StreamingSuccessDescriptor): void;
  fail(error: unknown, terminal: Exclude<StreamingTerminal, "ok">): void;
}

/** Open the one logical media span that owns a streaming result's correlation. */
export function openStreamingOperationObservation(
  options: Readonly<{
    provider: string;
    operation: "streamImage" | "streamSpeech";
    model?: string;
    route?: string;
  }>,
): StreamingOperationObservation {
  const primitive =
    options.operation === "streamImage"
      ? "media.generate_image"
      : "media.generate_speech";
  const startedAt = performance.now();
  const progress = createProgress();
  let attempts = 0;
  const span = observe.openSpan({
    name: `${options.operation}${options.model ? ` ${options.model}` : ""}`,
    primitive,
    attributes: {
      provider: options.provider,
      operation: options.operation,
      streamingRole: "logical",
      ...(options.model ? { model: options.model } : {}),
      ...(options.route ? { route: options.route } : {}),
    },
  });

  return {
    runId: span.runId,
    traceId: span.traceId,
    spanId: span.spanId,
    withContext: span.withContext.bind(span),
    startAttempt(descriptor) {
      attempts += 1;
      let attempt!: StreamingAttemptObservation;
      span.withContext(() => {
        attempt = openAttempt({
          provider: options.provider,
          operation: options.operation,
          primitive,
          model: descriptor.model,
          attempt: attempts,
        });
      });
      return attempt;
    },
    published(event) {
      progress.record(event);
      progress.commit();
    },
    succeed(descriptor) {
      const snapshot = progress.snapshot(startedAt);
      span.withContext(() => {
        if (descriptor.report) {
          observe.artifact({
            kind: "media.report",
            contentType: "application/json",
            encoding: "json",
            preview: Object.freeze({
              ...descriptor.report,
              streaming: Object.freeze({
                attemptCount: descriptor.attemptCount,
                ...snapshot,
              }),
            }),
            attributes: {
              provider: options.provider,
              operation: options.operation,
            },
          });
        }
      });
      span.end({
        attributes: {
          ...snapshot,
          provider: options.provider,
          operation: options.operation,
          model: descriptor.model,
          calls: descriptor.calls,
          attemptCount: descriptor.attemptCount,
          committed: progress.committed(),
          terminal: "ok",
        },
      });
    },
    fail(error, terminal) {
      observeSafeFailure(span, error, terminal, {
        ...progress.snapshot(startedAt),
        provider: options.provider,
        operation: options.operation,
        attemptCount: attempts,
        committed: progress.committed(),
      });
    },
  };
}

/** Classify a terminal path without retaining the thrown value. */
export function classifyStreamingTerminal(
  error: unknown,
  signal: AbortSignal,
): Exclude<StreamingTerminal, "ok"> {
  if (TimeoutError.isInstance(error)) return "timeout";
  if (signal.aborted) return "cancelled";
  return "error";
}

function openAttempt(
  options: Readonly<{
    provider: string;
    operation: "streamImage" | "streamSpeech";
    primitive: "media.generate_image" | "media.generate_speech";
    model: string;
    attempt: number;
  }>,
): StreamingAttemptObservation {
  const startedAt = performance.now();
  const progress = createProgress();
  const span = observe.openSpan({
    name: `${options.operation} attempt ${options.model}`,
    primitive: options.primitive,
    implicitRun: false,
    attributes: {
      provider: options.provider,
      operation: options.operation,
      streamingRole: "attempt",
      model: options.model,
      attempt: options.attempt,
    },
  });
  return {
    withContext: span.withContext.bind(span),
    candidate: (event) => progress.record(event),
    published: () => progress.commit(),
    succeed: () =>
      span.end({
        attributes: {
          ...progress.snapshot(startedAt),
          committed: progress.committed(),
          terminal: "ok",
        },
      }),
    fail: (error, terminal) =>
      observeSafeFailure(span, error, terminal, {
        ...progress.snapshot(startedAt),
        committed: progress.committed(),
        errorCategory: classifyError(error) ?? "unknown",
      }),
  };
}

function observeSafeFailure(
  span: OpenObservedSpan,
  error: unknown,
  terminal: Exclude<StreamingTerminal, "ok">,
  attributes: Record<string, unknown>,
): void {
  markErrorForObservation(error, safeFailureMessage(terminal));
  span.error(error, { ...attributes, terminal });
}

function safeFailureMessage(
  terminal: Exclude<StreamingTerminal, "ok">,
): string {
  if (terminal === "timeout") return "Streaming operation timed out.";
  if (terminal === "cancelled") return "Streaming operation was cancelled.";
  return "Streaming provider attempt failed.";
}

function createProgress() {
  let previewCount = 0;
  let deltaCount = 0;
  let finalCount = 0;
  let byteCount = 0;
  let firstEventAt: number | undefined;
  let isCommitted = false;
  const mediaTypes = new Set<string>();
  return {
    record(event: StreamingEventDescriptor) {
      firstEventAt ??= performance.now();
      if (event.kind === "preview") previewCount += 1;
      if (event.kind === "delta") deltaCount += 1;
      if (event.kind === "final") finalCount += 1;
      byteCount += event.byteCount;
      if (event.mediaType) mediaTypes.add(event.mediaType);
    },
    commit: () => {
      isCommitted = true;
    },
    committed: () => isCommitted,
    snapshot(startedAt: number) {
      return {
        previewCount,
        deltaCount,
        finalCount,
        byteCount,
        mediaTypes: [...mediaTypes],
        ...(firstEventAt === undefined
          ? {}
          : { firstEventMs: firstEventAt - startedAt }),
        durationMs: performance.now() - startedAt,
      };
    },
  };
}
