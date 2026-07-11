import type { Part } from "@google/genai";
import {
  contentText,
  createUnsupportedCapabilityError,
  type AssistantContentPart,
  type ContentPart,
  type DataAsset,
  type MessageContent,
  type ProviderFileAsset,
  type UrlAsset,
} from "@use-crux/core";

export {
  continuationOptions,
  googlePartsText,
  messageContentFromGoogleParts,
  type GoogleInboundPart,
} from "./content-parts-decode";

/** Encode canonical Crux message content into Google `Part[]` values. */
export function googleContentParts(
  _role: "system" | "user" | "assistant" | "tool",
  content: MessageContent,
): Part[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map(googleContentPart);
}

/** Project Google content to text. */
export function googleContentText(
  _role: "system" | "user" | "assistant" | "tool",
  content: string | readonly AssistantContentPart[],
): string {
  return contentText(content);
}

function googleContentPart(part: ContentPart): Part {
  switch (part.type) {
    case "text":
      return {
        text: part.text,
        ...continuationFields(part.providerOptions?.google?.continuation),
      };
    case "image":
    case "audio":
    case "video":
    case "file":
      return googleMediaPart(part);
  }
}

function googleMediaPart(
  part: Extract<ContentPart, { type: "image" | "audio" | "video" | "file" }>,
): Part {
  const source = part.source;
  const mediaType = part.mediaType ?? mediaTypeFromSource(source);
  if (!mediaType) {
    throw unsupported(
      `input.${part.type}.media_type`,
      "Google media parts require a mediaType before request encoding.",
    );
  }
  const displayName =
    part.type === "file"
      ? filename(part)
      : continuationDisplayName(part.providerOptions?.google?.continuation);
  const options = googlePartOptions(part);
  if (typeof source === "string")
    return { ...fileDataPart(source, mediaType, displayName), ...options };
  if (source instanceof URL)
    return { ...fileDataPart(source.href, mediaType, displayName), ...options };
  if (source instanceof Uint8Array)
    return { ...inlineDataPart(source, mediaType, displayName), ...options };
  if (source instanceof ArrayBuffer)
    return {
      ...inlineDataPart(new Uint8Array(source), mediaType, displayName),
      ...options,
    };
  if (isDataAsset(source))
    return {
      ...inlineDataPart(source.data, mediaType, displayName),
      ...options,
    };
  if (isUrlAsset(source))
    return {
      ...fileDataPart(source.url.href, mediaType, displayName),
      ...options,
    };
  if (isProviderFileAsset(source))
    return {
      ...fileDataPart(source.fileId, mediaType, displayName),
      ...options,
    };
  throw unsupported(
    `input.${part.type}.provider-file`,
    "Hydrate provider-file assets to a URL or byte source before calling Google.",
  );
}

function googlePartOptions(
  part: Extract<ContentPart, { type: "image" | "audio" | "video" | "file" }>,
): Record<string, unknown> {
  const mediaResolution = part.providerOptions?.google?.mediaResolution;
  const continuation = part.providerOptions?.google?.continuation;
  return {
    ...(isRecord(mediaResolution) ? { mediaResolution } : {}),
    ...continuationFields(continuation),
  };
}

function continuationFields(value: unknown): Record<string, unknown> {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          ([key]) => key !== "inlineDataDisplayName",
        ),
      )
    : {};
}

function continuationDisplayName(value: unknown): string | undefined {
  return isRecord(value) && typeof value.inlineDataDisplayName === "string"
    ? value.inlineDataDisplayName
    : undefined;
}

function filename(
  part: Extract<ContentPart, { type: "file" }>,
): string | undefined {
  if (part.filename) return part.filename;
  const source = part.source;
  if (typeof source === "object" && source !== null && "filename" in source) {
    return typeof source.filename === "string" ? source.filename : undefined;
  }
  return undefined;
}

function inlineDataPart(
  data: Uint8Array | Blob,
  mimeType: string,
  displayName: string | undefined,
): Part {
  if (!(data instanceof Uint8Array)) {
    throw unsupported(
      "input.file.blob",
      "Blob sources must be normalized to bytes before Google request encoding.",
    );
  }
  return {
    inlineData: {
      data: Buffer.from(data).toString("base64"),
      mimeType,
      ...(displayName ? { displayName } : {}),
    },
  };
}

function fileDataPart(
  fileUri: string,
  mimeType: string,
  displayName: string | undefined,
): Part {
  return {
    fileData: {
      fileUri,
      mimeType,
      ...(displayName ? { displayName } : {}),
    },
  };
}

function mediaTypeFromSource(
  source: Extract<
    ContentPart,
    { type: "image" | "audio" | "video" | "file" }
  >["source"],
): string | undefined {
  return isDataAsset(source) ||
    isUrlAsset(source) ||
    isProviderFileAsset(source)
    ? source.mediaType
    : undefined;
}

function isDataAsset(
  source: Extract<
    ContentPart,
    { type: "image" | "audio" | "video" | "file" }
  >["source"],
): source is DataAsset {
  return (
    typeof source === "object" &&
    source !== null &&
    !isBlob(source) &&
    "type" in source &&
    source.type === "data"
  );
}

function isUrlAsset(
  source: Extract<
    ContentPart,
    { type: "image" | "audio" | "video" | "file" }
  >["source"],
): source is UrlAsset {
  return (
    typeof source === "object" &&
    source !== null &&
    !isBlob(source) &&
    "type" in source &&
    source.type === "url"
  );
}

function isProviderFileAsset(
  source: Extract<
    ContentPart,
    { type: "image" | "audio" | "video" | "file" }
  >["source"],
): source is ProviderFileAsset {
  return (
    typeof source === "object" &&
    source !== null &&
    !isBlob(source) &&
    "type" in source &&
    source.type === "provider-file"
  );
}

function isBlob(source: unknown): source is Blob {
  return typeof Blob !== "undefined" && source instanceof Blob;
}

function unsupported(capability: string, remediation: string): never {
  throw createUnsupportedCapabilityError({
    adapter: "google",
    model: "<custom>",
    issues: [{ capability, remediation }],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
