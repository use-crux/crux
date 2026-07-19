/**
 * Runtime narrowing helpers for execution stream results.
 *
 * The shared execution facade can return either a core-step provider stream
 * handle or an SDK-loop executor stream handle. Native adapters are built on
 * the core-step dialect, so their public `stream()` path narrows to the
 * provider handle before constructing the canonical `StreamResult`.
 *
 * @internal
 * @module
 */

import type { StreamHandle } from "../types";
import type { CruxRunId, WithOperationResultMeta } from "../../observability";

/** Narrow an execution stream result to the core-step provider handle. */
export function assertStreamHandle<TRawStream>(
  value: unknown,
): asserts value is WithOperationResultMeta<StreamHandle<TRawStream>> &
  Readonly<{ runId: CruxRunId }> {
  if (!isStreamHandle(value)) {
    throw new TypeError(
      "Core-step adapter execution returned an SDK-loop stream handle.",
    );
  }
}

function isStreamHandle<TRawStream>(
  value: unknown,
): value is StreamHandle<TRawStream> & { readonly runId: CruxRunId } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<StreamHandle<TRawStream>>;
  return (
    isAsyncIterable(record.rawStream) &&
    typeof (record as { readonly runId?: unknown }).runId === "string" &&
    typeof record.extractTextDelta === "function" &&
    typeof record.completion === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof (value as { readonly [Symbol.asyncIterator]?: unknown })[
      Symbol.asyncIterator
    ] === "function"
  );
}
