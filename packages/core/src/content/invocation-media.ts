import { createInvalidMediaSourceError } from "./media-errors";
import type { Asset } from "../asset";
import { sha256Hex } from "./sha256";
import type { InvocationMediaSource } from "./invocation-types";
import { sniffImageMediaType } from "./media-sniff";
import {
  blobFilename,
  isAsset,
  isAssetRefShape,
  isBlob,
  mediaTypeOf,
  projectAsset,
  withFilename,
  withMediaType,
} from "./invocation-asset-projection";
import {
  looksLikeRawBase64,
  normalizeOptionalMediaType,
} from "./media-data-url";
import { normalizeInvocationDataUrl } from "./invocation-data-url";

export interface NormalizeInvocationMediaSourceInput {
  readonly kind: "image" | "audio" | "video" | "file";
  readonly source: InvocationMediaSource;
  readonly path: string;
  readonly mediaType?: string;
  readonly filename?: string;
  readonly provider?: string;
}

/** Normalize a private invocation media source into a usable `Asset`. */
export async function normalizeInvocationMediaSource(
  input: NormalizeInvocationMediaSourceInput,
): Promise<Asset> {
  const explicitMediaType = normalizeOptionalMediaType(
    input.mediaType,
    input.path,
  );
  if (isAsset(input.source)) {
    return normalizeAssetSource(input, input.source, explicitMediaType);
  }
  if (isAssetRefShape(input.source)) {
    throw invalid(
      input.path,
      "AssetRef is persistence plumbing, not model input. Hydrate it with assetStore.get(ref) first.",
    );
  }
  if (typeof input.source === "string") {
    return normalizeStringSource(input, input.source, explicitMediaType);
  }
  if (input.source instanceof URL) {
    return normalizeUrl(input, input.source, explicitMediaType);
  }
  if (input.source instanceof Uint8Array) {
    return normalizeBytes(
      input,
      new Uint8Array(input.source),
      explicitMediaType,
    );
  }
  if (input.source instanceof ArrayBuffer) {
    return normalizeBytes(
      input,
      new Uint8Array(input.source.slice(0)),
      explicitMediaType,
    );
  }
  if (isBlob(input.source)) {
    return normalizeBlob(input, input.source, explicitMediaType);
  }
  throw invalid(
    input.path,
    "Media source must be an Asset, HTTPS/data URL, Uint8Array, ArrayBuffer, or Blob.",
  );
}

async function normalizeAssetSource(
  input: NormalizeInvocationMediaSourceInput,
  asset: Asset,
  explicitMediaType: string | undefined,
): Promise<Asset> {
  let projected = projectAsset(asset, input.path);
  if (projected.type === "data" && isBlob(projected.data)) {
    projected = {
      ...projected,
      data: new Uint8Array(await projected.data.arrayBuffer()),
    };
  }
  const assetMediaType = mediaTypeOf(projected);
  if (
    explicitMediaType &&
    assetMediaType &&
    explicitMediaType !== assetMediaType
  ) {
    throw invalid(
      input.path,
      "Explicit mediaType conflicts with the Asset mediaType.",
    );
  }
  if (projected.type === "url" && projected.url.protocol === "data:") {
    const decoded = normalizeInvocationDataUrl(
      input,
      projected.url.href,
      explicitMediaType ?? assetMediaType,
    );
    if (decoded.type !== "data") return decoded;
    const {
      type: _type,
      url: _url,
      mediaType: _mediaType,
      size: _size,
      sha256: _sha256,
      filename: sourceFilename,
      ...sourceInfo
    } = projected;
    return assertKind(input, {
      ...sourceInfo,
      ...decoded,
      ...(input.filename ?? sourceFilename
        ? { filename: input.filename ?? sourceFilename }
        : {}),
    });
  }
  if (
    projected.type === "provider-file" &&
    input.provider &&
    projected.provider !== input.provider
  ) {
    throw invalid(
      input.path,
      `Provider-file assets must belong to ${input.provider}.`,
    );
  }
  return assertKind(
    input,
    withFilename(
      withMediaType(projected, explicitMediaType ?? assetMediaType),
      input.filename,
    ),
  );
}

function normalizeStringSource(
  input: NormalizeInvocationMediaSourceInput,
  source: string,
  explicitMediaType: string | undefined,
): Asset {
  if (looksLikeRawBase64(source)) {
    throw invalid(
      input.path,
      "Raw base64 strings are not media sources. Use a data URL or Uint8Array.",
    );
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw invalid(
      input.path,
      "String media sources must be HTTPS URLs or data URLs.",
    );
  }
  return normalizeUrl(input, url, explicitMediaType);
}

function normalizeUrl(
  input: NormalizeInvocationMediaSourceInput,
  url: URL,
  explicitMediaType: string | undefined,
): Asset {
  if (url.protocol === "data:")
    return normalizeInvocationDataUrl(input, url.href, explicitMediaType);
  if (url.protocol !== "https:") {
    throw invalid(
      input.path,
      "URL media sources must use HTTPS or data protocol.",
    );
  }
  return assertKind(
    input,
    withFilename(
      {
        type: "url",
        url: new URL(url.href),
        ...(explicitMediaType ? { mediaType: explicitMediaType } : {}),
      },
      input.filename,
    ),
  );
}

async function normalizeBlob(
  input: NormalizeInvocationMediaSourceInput,
  blob: Blob,
  explicitMediaType: string | undefined,
): Promise<Asset> {
  const blobMediaType = normalizeOptionalMediaType(
    blob.type || undefined,
    input.path,
  );
  if (
    explicitMediaType &&
    blobMediaType &&
    explicitMediaType !== blobMediaType
  ) {
    throw invalid(
      input.path,
      "Explicit mediaType conflicts with the Blob type.",
    );
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mediaType =
    explicitMediaType ?? blobMediaType ?? sniffForKind(input, bytes);
  return assertKind(
    input,
    withFilename(
      {
        type: "data",
        data: bytes,
        mediaType,
        size: blob.size,
        sha256: sha256Hex(bytes),
      },
      input.filename ?? blobFilename(blob),
    ),
  );
}

function normalizeBytes(
  input: NormalizeInvocationMediaSourceInput,
  bytes: Uint8Array,
  explicitMediaType: string | undefined,
): Asset {
  const mediaType = explicitMediaType ?? sniffForKind(input, bytes);
  return assertKind(
    input,
    withFilename(
      {
        type: "data",
        data: bytes,
        mediaType,
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
      },
      input.filename,
    ),
  );
}

function sniffForKind(
  input: NormalizeInvocationMediaSourceInput,
  bytes: Uint8Array,
): string {
  const mediaType =
    input.kind === "image" ? sniffImageMediaType(bytes) : undefined;
  if (!mediaType) {
    throw invalid(
      input.path,
      `${label(input.kind)} byte sources require an explicit mediaType.`,
    );
  }
  return mediaType;
}

const KIND_MEDIA_PREFIX: Readonly<Record<"image" | "audio" | "video", string>> = {
  image: "image/",
  audio: "audio/",
  video: "video/",
};

function assertKind(
  input: NormalizeInvocationMediaSourceInput,
  asset: Asset,
): Asset {
  const mediaType = mediaTypeOf(asset);
  if (input.kind === "file") return projectAsset(asset, input.path);
  const prefix = KIND_MEDIA_PREFIX[input.kind];
  if (mediaType && !mediaType.startsWith(prefix)) {
    throw invalid(
      input.path,
      `${label(input.kind)} sources require a ${prefix}* mediaType, received ${mediaType}.`,
    );
  }
  return projectAsset(asset, input.path);
}

function label(kind: "image" | "audio" | "video" | "file"): string {
  switch (kind) {
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "file":
      return "File";
  }
}

function invalid(path: string, reason: string): never {
  throw createInvalidMediaSourceError({ path, reason });
}
