/**
 * Opaque versions for Convex store-document compare-and-set operations.
 *
 * The version covers every persisted value field that can affect decoded
 * records. Convex compares it inside the write transaction, so callers never
 * publish against a stale read.
 *
 * @module
 */

import type { StoreDocRecord } from "./types";

/** Derive the opaque compare-and-set version for one raw store document. */
export function storeDocVersion(doc: StoreDocRecord): string {
  return JSON.stringify([
    doc.updatedAt ?? null,
    doc.content ?? null,
    doc.metadata ?? null,
    doc.embedding ?? null,
  ]);
}
