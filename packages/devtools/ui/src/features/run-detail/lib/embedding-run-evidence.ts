/** Byte-safe view model for dedicated embedding span evidence. @module */

import type { EmbeddingModality } from "@use-crux/core/embedding";
import type { ObservabilityRunDetailNode } from "@/types";
import { findArtifact, findAttribute } from "./span-detail-inspection";

const MODALITY_ORDER = [
  "text",
  "image",
  "audio",
  "video",
  "document",
] as const satisfies readonly EmbeddingModality[];

/** One non-zero modality count shown on an embedding card. */
export interface EmbeddingModalityCountView {
  readonly modality: EmbeddingModality;
  readonly count: number;
}

/** Closed, byte-safe embedding evidence consumed by Run Detail. */
export interface EmbeddingRunEvidence {
  readonly role?: "query" | "document";
  readonly modalityCounts: readonly EmbeddingModalityCountView[];
  readonly embeddingSpace?: string;
  readonly embeddingName?: string;
  readonly model?: string;
  readonly dimensions?: number;
  readonly inputCount?: number;
  readonly cacheHitCount?: number;
  readonly truncatedCount?: number;
  readonly retryCount?: number;
  readonly rateLimitWaitMs?: number;
}

/** Project recognized span/report fields without retaining arbitrary attributes. */
export function projectEmbeddingRunEvidence(
  node: ObservabilityRunDetailNode,
): EmbeddingRunEvidence {
  const report = asRecord(findArtifact(node, "embedding.report")?.preview);
  const value = (...keys: readonly string[]) =>
    findAttribute(node, ...keys) ?? firstValue(report, keys);
  const role = roleValue(value("role"));
  const embeddingSpace = digestValue(value("embeddingSpace"));
  const embeddingName = stringValue(value("embeddingName", "name"));
  const model = stringValue(node.model || value("model", "modelId"));
  const dimensions = nonNegativeNumber(
    value("dimensions", "dims", "dimension"),
  );
  const inputCount = nonNegativeNumber(value("inputs", "inputCount", "count"));
  const cacheHitCount = nonNegativeNumber(
    value("cacheHits", "cacheHitCount", "cachedInputs", "cached"),
  );
  const truncatedCount = nonNegativeNumber(
    value("truncations", "truncatedCount", "truncated"),
  );
  const retryCount = nonNegativeNumber(value("retries", "retryCount"));
  const rateLimitWaitMs = nonNegativeNumber(
    value("rateLimitWaitMs", "rateLimitWait"),
  );
  return Object.freeze({
    ...(role ? { role } : {}),
    modalityCounts: projectModalityCounts(value("modalityCounts")),
    ...(embeddingSpace ? { embeddingSpace } : {}),
    ...(embeddingName ? { embeddingName } : {}),
    ...(model ? { model } : {}),
    ...(dimensions !== undefined ? { dimensions } : {}),
    ...(inputCount !== undefined ? { inputCount } : {}),
    ...(cacheHitCount !== undefined ? { cacheHitCount } : {}),
    ...(truncatedCount !== undefined ? { truncatedCount } : {}),
    ...(retryCount !== undefined ? { retryCount } : {}),
    ...(rateLimitWaitMs !== undefined ? { rateLimitWaitMs } : {}),
  });
}

/** Stable twelve-character display form; the full digest remains copyable. */
export function shortEmbeddingSpaceDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

function projectModalityCounts(
  value: unknown,
): readonly EmbeddingModalityCountView[] {
  const counts = asRecord(value);
  return Object.freeze(
    MODALITY_ORDER.flatMap((modality) => {
      const count = positiveInteger(counts?.[modality]);
      return count === undefined
        ? []
        : [Object.freeze({ modality, count })];
    }),
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function roleValue(value: unknown): "query" | "document" | undefined {
  return value === "query" || value === "document" ? value : undefined;
}

function digestValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function firstValue(
  record: Record<string, unknown> | undefined,
  keys: readonly string[],
): unknown {
  return keys.map((key) => record?.[key]).find((value) => value != null);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
