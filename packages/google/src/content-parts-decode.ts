import {
  contentText,
  type ContentPart,
  type MessageContent,
  type ProviderOptions,
} from "@use-crux/core";

/** Minimal inbound Google part shape used by decoder paths. */
export interface GoogleInboundPart {
  readonly text?: string;
  readonly functionCall?: unknown;
  readonly functionResponse?: unknown;
  readonly inlineData?: unknown;
  readonly fileData?: unknown;
  readonly thought?: unknown;
  readonly thoughtSignature?: unknown;
}

/** Decode Google `Part[]` values into canonical Crux content. */
export function messageContentFromGoogleParts(
  parts: readonly GoogleInboundPart[],
): MessageContent {
  const content = parts.flatMap((part): ContentPart[] => {
    if (part.thought === true && typeof part.text === "string") return [];
    const providerOptions = continuationOptions(part);
    if (typeof part.text === "string")
      return [{ type: "text", text: part.text, ...providerOptions }];
    if (isGoogleBlob(part.inlineData))
      return [
        inlineDataToPart(
          part.inlineData,
          continuationOptions(part, {
            ...(part.inlineData.displayName
              ? { inlineDataDisplayName: part.inlineData.displayName }
              : {}),
          }),
        ),
      ];
    if (isGoogleFileData(part.fileData)) {
      return [
        mediaPart(
          part.fileData.fileUri,
          part.fileData.mimeType,
          part.fileData.displayName,
          providerOptions,
        ),
      ];
    }
    return [];
  });
  if (content.length === 0) return "";
  return content.every(
    (part) => part.type === "text" && part.providerOptions === undefined,
  )
    ? content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("")
    : content;
}

/** Text projection for decoded Google `Part[]` values. */
export function googlePartsText(parts: readonly GoogleInboundPart[]): string {
  return contentText(messageContentFromGoogleParts(parts));
}

function inlineDataToPart(inlineData: {
  readonly data: string;
  readonly mimeType: string;
  readonly displayName?: string;
}, options: { readonly providerOptions?: ProviderOptions }): ContentPart {
  const source = {
    type: "data" as const,
    data: new Uint8Array(Buffer.from(inlineData.data, "base64")),
    mediaType: inlineData.mimeType,
  };
  return mediaPart(source, inlineData.mimeType, inlineData.displayName, options);
}

function mediaPart(
  source: Extract<ContentPart, { type: "file" }>["source"],
  mediaType: string,
  displayName: string | undefined,
  options: { readonly providerOptions?: ProviderOptions },
): ContentPart {
  if (mediaType.startsWith("image/"))
    return { type: "image", source, mediaType, ...options };
  if (mediaType.startsWith("audio/"))
    return { type: "audio", source, mediaType, ...options };
  if (mediaType.startsWith("video/"))
    return { type: "video", source, mediaType, ...options };
  return {
    type: "file",
    source,
    mediaType,
    ...(typeof displayName === "string" ? { filename: displayName } : {}),
    ...options,
  };
}

/** Capture only provider-native continuation fields, never content payloads. */
export function continuationOptions(
  part: GoogleInboundPart,
  extra: Readonly<Record<string, string>> = {},
): { readonly providerOptions?: ProviderOptions } {
  const continuation = {
    ...extra,
    ...(typeof part.thought === "boolean" ? { thought: part.thought } : {}),
    ...(typeof part.thoughtSignature === "string"
      ? { thoughtSignature: part.thoughtSignature }
      : {}),
  };
  return Object.keys(continuation).length > 0
    ? { providerOptions: { google: { continuation } } }
    : {};
}

function isGoogleBlob(value: unknown): value is {
  readonly data: string;
  readonly mimeType: string;
  readonly displayName?: string;
} {
  return (
    isRecord(value) &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string" &&
    (value.displayName === undefined || typeof value.displayName === "string")
  );
}

function isGoogleFileData(value: unknown): value is {
  readonly fileUri: string;
  readonly mimeType: string;
  readonly displayName?: string;
} {
  return (
    isRecord(value) &&
    typeof value.fileUri === "string" &&
    typeof value.mimeType === "string" &&
    (value.displayName === undefined || typeof value.displayName === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
