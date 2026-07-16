import type { JsonValue } from "../../storage";
import type { RuntimePruneResult } from "../ports/retention";

/** Media type for canonical private Runtime result payloads. */
export const RUNTIME_RESULT_MEDIA_TYPE =
  "application/vnd.crux.eval-result+json" as const;

/** Maximum canonical UTF-8 payload size admitted by Eval host protocol V1. */
export const RUNTIME_RESULT_MAX_BYTES = 1024 * 1024;

/** Content-addressed reference committed on terminal Runtime work. */
export interface RuntimeResultRef {
  /** SHA-256 of the canonical UTF-8 JSON payload. */
  readonly sha256: string;
  /** Canonical UTF-8 payload size in bytes. */
  readonly size: number;
  /** Stable private result envelope media type. */
  readonly mediaType: typeof RUNTIME_RESULT_MEDIA_TYPE;
  /** Adapter-owned bounded opaque location without credentials. */
  readonly location: string;
}

/** Scope required when writing a private Runtime result. */
export interface RuntimeResultPutOptions {
  /** Runtime namespace owning every work reference to this payload. */
  readonly namespace: string;
}

/** Bounded orphan cleanup request for one Runtime namespace. */
export interface RuntimeResultPruneOptions {
  readonly namespace: string;
  readonly before: Date;
  readonly limit: number;
}

/** Adapter storage for canonical content-addressed Runtime results. */
export interface RuntimeResultPayloadPort {
  /** Store a JSON payload idempotently and return its durable reference. */
  put(
    payload: JsonValue,
    options: RuntimeResultPutOptions,
  ): Promise<RuntimeResultRef>;
  /** Read and integrity-check a payload, or return null when it is absent. */
  get(ref: RuntimeResultRef): Promise<JsonValue | null>;
  /** Delete one result idempotently after the kernel proves it is unreferenced. */
  delete(ref: RuntimeResultRef): Promise<void>;
  /** Delete old payloads that no durable work item references. */
  pruneUnreferenced(
    options: RuntimeResultPruneOptions,
  ): Promise<RuntimePruneResult>;
}

/** Clone and freeze a Runtime-owned result reference. */
export function cloneRuntimeResultRef(ref: RuntimeResultRef): RuntimeResultRef {
  return Object.freeze({
    sha256: ref.sha256,
    size: ref.size,
    mediaType: ref.mediaType,
    location: ref.location,
  });
}
