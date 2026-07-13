import type { Asset } from "../asset";
import { assertValidAsset } from "../asset/validation";
import { createInvalidMediaSourceError } from "./media-errors";
import { copyAssetInfo } from "./invocation-asset-info";
import { normalizeMediaType } from "./media-data-url";

export function projectAsset(asset: Asset, path: string): Asset {
  try {
    assertValidAsset(asset);
  } catch (error) {
    throw createInvalidMediaSourceError({
      path,
      reason: error instanceof Error ? error.message : "Invalid Asset.",
    });
  }
  switch (asset.type) {
    case "data":
      return Object.freeze({
        ...copyAssetInfo(asset),
        type: "data",
        data:
          asset.data instanceof Uint8Array
            ? new Uint8Array(asset.data)
            : asset.data,
        mediaType: normalizeMediaType(asset.mediaType, path),
      });
    case "url":
      return Object.freeze({
        ...copyAssetInfo(asset),
        type: "url",
        url: new URL(asset.url.href),
        ...(asset.mediaType
          ? { mediaType: normalizeMediaType(asset.mediaType, path) }
          : {}),
      });
    case "provider-file":
      return Object.freeze({
        ...copyAssetInfo(asset),
        type: "provider-file",
        provider: asset.provider.trim(),
        fileId: asset.fileId.trim(),
        ...(asset.mediaType
          ? { mediaType: normalizeMediaType(asset.mediaType, path) }
          : {}),
      });
  }
}

export function withMediaType(
  asset: Asset,
  mediaType: string | undefined,
): Asset {
  return mediaType && asset.type !== "data" ? { ...asset, mediaType } : asset;
}

export function withFilename(
  asset: Asset,
  filename: string | undefined,
): Asset {
  return filename === undefined ? asset : { ...asset, filename };
}

export function mediaTypeOf(asset: Asset): string | undefined {
  return asset.mediaType;
}

export function isAsset(value: unknown): value is Asset {
  return (
    isRecord(value) &&
    (value.type === "data" ||
      value.type === "url" ||
      value.type === "provider-file")
  );
}

export function isAssetRefShape(
  value: unknown,
): value is { readonly uri: string } {
  return isRecord(value) && typeof value.uri === "string" && !("type" in value);
}

export function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

export function blobFilename(blob: Blob): string | undefined {
  if (!("name" in blob) || typeof blob.name !== "string") return undefined;
  return blob.name;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
