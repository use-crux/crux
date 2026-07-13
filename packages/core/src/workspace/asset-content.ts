/**
 * Workspace AssetStore conversion and hydration helpers.
 *
 * Keeps bounded stream consumption, DataAsset projection, and asset-read
 * validation separate from workspace transaction/version orchestration.
 *
 * @module
 */

import type { DataAsset, StoredAsset } from "../asset";

/** Convert workspace payload bytes/text into a store-owned data asset. */
export function workspaceDataAsset(input: {
  readonly data: string | Uint8Array | Blob;
  readonly mediaType: string;
  readonly size: number;
}): DataAsset {
  if (typeof input.data === "string") {
    return {
      type: "data",
      data: new TextEncoder().encode(input.data),
      mediaType: input.mediaType,
      size: input.size,
    };
  }
  if (input.data instanceof Uint8Array) {
    return {
      type: "data",
      data: new Uint8Array(input.data),
      mediaType: input.mediaType,
      size: input.size,
    };
  }
  return {
    type: "data",
    data: input.data,
    mediaType: input.mediaType,
    size: input.size,
  };
}

/** Read a bounded stream into a Blob before writing it to an AssetStore. */
export async function boundedStreamBlob(input: {
  readonly stream: ReadableStream<Uint8Array>;
  readonly mediaType: string;
  readonly maxBytes: number | undefined;
  readonly path: string;
}): Promise<Blob> {
  if (
    input.maxBytes === undefined ||
    !Number.isFinite(input.maxBytes) ||
    input.maxBytes < 0
  ) {
    throw new Error(
      `workspace.write(): ReadableStream content for "${input.path}" requires finite limits.maxFileBytes.`,
    );
  }
  const reader = input.stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      total += read.value.byteLength;
      if (total > input.maxBytes) {
        throw new Error(
          `workspace.write(): stream for "${input.path}" exceeds limits.maxFileBytes (${input.maxBytes}).`,
        );
      }
      chunks.push(read.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks.map(copyArrayBuffer), { type: input.mediaType });
}

/** Ensure a stored asset can be used to hydrate workspace content. */
export function requireStoredDataAsset(
  asset: StoredAsset,
  path: string,
): Extract<StoredAsset, { readonly type: "data" }> {
  if (asset.type !== "data") {
    throw new Error(
      `workspace.read(): asset-backed file "${path}" requires a data asset from AssetStore.`,
    );
  }
  return asset;
}

/** Decode data asset content as UTF-8 text. */
export async function dataAssetText(
  asset: Pick<DataAsset, "data">,
): Promise<string> {
  if (asset.data instanceof Uint8Array) {
    return new TextDecoder().decode(asset.data);
  }
  return asset.data.text();
}

/** Copy data asset content into bytes. */
export async function dataAssetBytes(
  asset: Pick<DataAsset, "data">,
): Promise<Uint8Array> {
  if (asset.data instanceof Uint8Array) return new Uint8Array(asset.data);
  return new Uint8Array(await asset.data.arrayBuffer());
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
