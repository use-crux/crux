import type { Asset } from "../asset";
import { createInvalidMediaSourceError } from "./media-errors";
import { projectAsset, withFilename } from "./invocation-asset-projection";
import type { NormalizeInvocationMediaSourceInput } from "./invocation-media";
import { parseDataUrl } from "./media-data-url";
import { sniffImageMediaType } from "./media-sniff";
import { sha256Hex } from "./sha256";

/** Decode one bounded data URL into a usable invocation data asset. */
export function normalizeInvocationDataUrl(
  input: NormalizeInvocationMediaSourceInput,
  value: string,
  explicitMediaType: string | undefined,
): Asset {
  const parsed = parseDataUrl(value, input.path);
  const mediaType =
    explicitMediaType ?? parsed.mediaType ?? sniffImageMediaType(parsed.data);
  if (!mediaType) {
    throw invalid(
      input.path,
      `${input.kind === "image" ? "Image" : "File"} data URLs require a mediaType.`,
    );
  }
  if (
    parsed.mediaType &&
    explicitMediaType &&
    parsed.mediaType !== explicitMediaType
  ) {
    throw invalid(
      input.path,
      "Explicit mediaType conflicts with the data URL media type.",
    );
  }
  if (input.kind === "image" && !mediaType.startsWith("image/")) {
    throw invalid(
      input.path,
      `Image sources require an image mediaType, received ${mediaType}.`,
    );
  }
  return projectAsset(
    withFilename(
      {
        type: "data",
        data: parsed.data,
        mediaType,
        size: parsed.data.byteLength,
        sha256: sha256Hex(parsed.data),
      },
      input.filename,
    ),
    input.path,
  );
}

function invalid(path: string, reason: string): never {
  throw createInvalidMediaSourceError({ path, reason });
}
