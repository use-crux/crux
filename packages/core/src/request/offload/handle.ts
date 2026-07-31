/**
 * Opaque exact-recovery handle identity and deterministic previews.
 *
 * @module
 */

import { sha256Hex } from "../../content/sha256";

const encoder = new TextEncoder();
const MAX_PREVIEW_CHARS = 200;

/** Opaque provider-neutral exact-recovery handle. */
export interface OffloadHandle {
  /** Opaque value passed only to the bounded retrieval capability. */
  readonly id: string;
  /** Pinned publication revision. */
  readonly revision: 1;
}

/** Public evidence for one exact-recovery publication. */
export interface OffloadReceipt {
  /** Opaque handle exposed to the model-facing retrieval capability. */
  readonly handle: string;
  /** Pinned publication revision. */
  readonly revision: 1;
  /** Exact serialized byte size retained outside the model view. */
  readonly bytes: number;
}

/** Canonical serialized value retained by exact-recovery backing. @internal */
export interface SerializedOffloadValue {
  readonly encoding: "text" | "json" | "asset";
  readonly contentType: string;
  readonly serialized: string;
  readonly bytes: number;
  readonly preview?: string;
}

/** Serialize a supported canonical value without losing exact JSON structure. @internal */
export function serializeOffloadValue(
  value: unknown,
): SerializedOffloadValue {
  if (typeof value === "string") {
    return Object.freeze({
      encoding: "text",
      contentType: "text/plain",
      serialized: value,
      bytes: encoder.encode(value).byteLength,
    });
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError(
      "Exact-recovery backing requires a string or JSON-serializable value.",
    );
  }
  return Object.freeze({
    encoding: "json",
    contentType: "application/json",
    serialized,
    bytes: encoder.encode(serialized).byteLength,
  });
}

/** Derive an opaque handle without exposing a storage key or source content. @internal */
export function createOffloadHandle(
  owner: string,
  value: SerializedOffloadValue,
): OffloadHandle {
  const digest = sha256Hex(
    encoder.encode(`${owner}\0${value.contentType}\0${value.serialized}`),
  );
  return Object.freeze({
    id: `offload_${digest.slice(0, 32)}`,
    revision: 1,
  });
}

/** Render one bounded type-aware model view. @internal */
export function offloadPreview(
  handle: OffloadHandle,
  value: SerializedOffloadValue,
): string {
  if (value.encoding === "asset") {
    return `[Exact ${value.contentType} asset reference]\nPreview: ${value.preview ?? "binary asset"}\nHandle: ${handle.id}`;
  }
  const preview =
    value.serialized.length <= MAX_PREVIEW_CHARS
      ? value.serialized
      : `${value.serialized.slice(0, MAX_PREVIEW_CHARS)}…`;
  const type =
    value.contentType === "text/plain" ? "text" : "JSON";
  return `[Exact ${type} reference]\nPreview: ${preview}\nHandle: ${handle.id}`;
}
