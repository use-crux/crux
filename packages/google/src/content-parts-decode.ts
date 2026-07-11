import {
  contentText,
  type ContentPart,
  type MessageContent,
} from "@use-crux/core";

/** Minimal inbound Google part shape used by decoder paths. */
export interface GoogleInboundPart {
  readonly text?: string;
  readonly functionCall?: unknown;
  readonly functionResponse?: unknown;
  readonly inlineData?: unknown;
  readonly fileData?: unknown;
}

/** Decode Google `Part[]` values into canonical Crux content. */
export function messageContentFromGoogleParts(
  parts: readonly GoogleInboundPart[],
): MessageContent {
  const content = parts.flatMap((part): ContentPart[] => {
    if (typeof part.text === "string")
      return [{ type: "text", text: part.text }];
    if (isGoogleBlob(part.inlineData))
      return [inlineDataToPart(part.inlineData)];
    if (isGoogleFileData(part.fileData)) {
      return [
        mediaPart(
          part.fileData.fileUri,
          part.fileData.mimeType,
          part.fileData.displayName,
        ),
      ];
    }
    return [];
  });
  if (content.length === 0) return "";
  return content.every((part) => part.type === "text")
    ? content.map((part) => part.text).join("")
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
}): ContentPart {
  const source = {
    type: "data" as const,
    data: new Uint8Array(Buffer.from(inlineData.data, "base64")),
    mediaType: inlineData.mimeType,
  };
  return mediaPart(source, inlineData.mimeType, inlineData.displayName);
}

function mediaPart(
  source: Extract<ContentPart, { type: "file" }>["source"],
  mediaType: string,
  displayName: string | undefined,
): ContentPart {
  if (mediaType.startsWith("image/"))
    return { type: "image", source, mediaType };
  if (mediaType.startsWith("audio/"))
    return { type: "audio", source, mediaType };
  if (mediaType.startsWith("video/"))
    return { type: "video", source, mediaType };
  return {
    type: "file",
    source,
    mediaType,
    ...(typeof displayName === "string" ? { filename: displayName } : {}),
  };
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
