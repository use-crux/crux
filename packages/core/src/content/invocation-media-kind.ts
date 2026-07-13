import type { Asset } from "../asset";
import { createInvalidMediaSourceError } from "./media-errors";
import { mediaTypeOf, projectAsset } from "./invocation-asset-projection";
import { sniffImageMediaType } from "./media-sniff";
import type { NormalizeInvocationMediaSourceInput } from "./invocation-media";

const KIND_MEDIA_PREFIX = Object.freeze({
  image: "image/",
  audio: "audio/",
  video: "video/",
});

/** Infer media type only where byte signatures are deterministic. */
export function sniffInvocationMediaType(
  input: NormalizeInvocationMediaSourceInput,
  bytes: Uint8Array,
): string {
  const mediaType =
    input.kind === "image" ? sniffImageMediaType(bytes) : undefined;
  if (!mediaType) {
    throw createInvalidMediaSourceError({
      path: input.path,
      reason: `${kindLabel(input.kind)} byte sources require an explicit mediaType.`,
    });
  }
  return mediaType;
}

/** Enforce kind-specific MIME laws and return a defensive asset projection. */
export function assertInvocationMediaKind(
  input: NormalizeInvocationMediaSourceInput,
  asset: Asset,
): Asset {
  const mediaType = mediaTypeOf(asset);
  if (input.kind === "file") return projectAsset(asset, input.path);
  const prefix = KIND_MEDIA_PREFIX[input.kind];
  if (mediaType && !mediaType.startsWith(prefix)) {
    throw createInvalidMediaSourceError({
      path: input.path,
      reason: `${kindLabel(input.kind)} sources require a ${prefix}* mediaType, received ${mediaType}.`,
    });
  }
  return projectAsset(asset, input.path);
}

function kindLabel(kind: NormalizeInvocationMediaSourceInput["kind"]): string {
  return kind[0]!.toUpperCase() + kind.slice(1);
}
