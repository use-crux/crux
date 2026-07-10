import { StorageError } from "../storage/errors";
import type { Asset, AssetInfo } from "./types";

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const MIME_ESSENCE_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export function assertValidAsset(asset: Asset): void {
  assertAssetInfo(asset);
  switch (asset.type) {
    case "data":
      assertDataAssetMediaType(asset);
      if (!(asset.data instanceof Uint8Array) && !isBlob(asset.data)) {
        throw new StorageError(
          "invalid_value",
          "Data asset data must be a Uint8Array or Blob.",
        );
      }
      return;
    case "url":
      assertAllowedUrl(asset.url);
      if (asset.mediaType !== undefined) normalizeMediaType(asset.mediaType);
      return;
    case "provider-file":
      if (asset.provider.trim().length === 0) {
        throw new StorageError(
          "invalid_value",
          "Provider-file asset provider must not be empty.",
        );
      }
      if (asset.fileId.trim().length === 0) {
        throw new StorageError(
          "invalid_value",
          "Provider-file asset fileId must not be empty.",
        );
      }
      if (asset.mediaType !== undefined) normalizeMediaType(asset.mediaType);
      return;
    default:
      assertNever(asset);
  }
}

export function assertAllowedUrl(url: URL): void {
  if (url.protocol !== "https:" && url.protocol !== "data:") {
    throw new StorageError(
      "invalid_value",
      "URL asset must use HTTPS or data protocol.",
    );
  }
}

export function assertAssetInfo(info: AssetInfo): void {
  if (info.filename !== undefined && info.filename.trim().length === 0) {
    throw new StorageError(
      "invalid_value",
      "Asset filename must not be empty.",
    );
  }
  if (
    info.size !== undefined &&
    (!Number.isFinite(info.size) || info.size < 0)
  ) {
    throw new StorageError(
      "invalid_value",
      "Asset size must be a finite non-negative number.",
    );
  }
  if (info.sha256 !== undefined && !SHA256_HEX_RE.test(info.sha256)) {
    throw new StorageError(
      "invalid_value",
      "Asset sha256 must be a lowercase 64-character hexadecimal digest.",
    );
  }
  if (info.width !== undefined && !isPositiveInteger(info.width)) {
    throw new StorageError(
      "invalid_value",
      "Asset width must be a positive integer.",
    );
  }
  if (info.height !== undefined && !isPositiveInteger(info.height)) {
    throw new StorageError(
      "invalid_value",
      "Asset height must be a positive integer.",
    );
  }
  if (
    info.durationInSeconds !== undefined &&
    (!Number.isFinite(info.durationInSeconds) || info.durationInSeconds < 0)
  ) {
    throw new StorageError(
      "invalid_value",
      "Asset durationInSeconds must be a finite non-negative number.",
    );
  }
  if (info.pageCount !== undefined && !isPositiveInteger(info.pageCount)) {
    throw new StorageError(
      "invalid_value",
      "Asset pageCount must be a positive integer.",
    );
  }
}

export function normalizeMediaType(mediaType: string): string {
  const essence = mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!MIME_ESSENCE_RE.test(essence)) {
    throw new StorageError(
      "invalid_value",
      "Asset mediaType must be a valid MIME type essence.",
    );
  }
  return essence;
}

function assertDataAssetMediaType(
  asset: Extract<Asset, { readonly type: "data" }>,
): void {
  const assetMediaType = normalizeMediaType(asset.mediaType);
  if (!isBlob(asset.data) || asset.data.type.trim().length === 0) return;

  const blobMediaType = normalizeMediaType(asset.data.type);
  if (blobMediaType !== assetMediaType) {
    throw new StorageError(
      "invalid_value",
      "Data asset mediaType must match the Blob type.",
    );
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}

function assertNever(_value: never): never {
  throw new StorageError("invalid_value", "Unsupported asset type.");
}
