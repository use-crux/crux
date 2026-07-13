import type { Message } from "../generation/messages";
import type {
  AssistantContentPart,
  ContentPart,
  MessageContent,
} from "../types/content";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { sha256Hex } from "./sha256";

const MAX_DESCRIPTOR_HASH_BYTES = 256 * 1024;

export {
  createInvalidMediaSourceError,
  createMediaMaterializationError,
  createUnsupportedCapabilityError,
  isInvalidMediaSourceError,
  isMediaMaterializationError,
  isUnsupportedCapabilityError,
} from "./media-errors";
export type {
  InvalidMediaSourceError,
  MediaMaterializationError,
  MediaMaterializationReason,
  UnsupportedCapabilityError,
  UnsupportedCapabilityIssue,
} from "./media-errors";

/**
 * Create a text content part.
 *
 * This is only a small convenience for code that builds part arrays
 * programmatically. Media does not need a helper: pass a URL, Blob, bytes, or
 * Asset directly as `source` on an `image` or `file` part. The helper has no
 * side effects and performs no validation.
 */
export function textPart(text: string): ContentPart {
  return { type: "text", text };
}

/**
 * Project canonical content into bounded text for string-only subsystems.
 *
 * Accepts both plain `ContentPart` content (system/user/tool messages) and
 * assistant `AssistantContentPart` content, so callers can format any
 * canonical message without branching on role.
 */
export function contentText(
  content: string | readonly AssistantContentPart[],
): string {
  if (typeof content === "string") return content;
  return content.map(partText).join("\n");
}

/** Project a canonical message's content into bounded text. */
export function messageText(message: Pick<Message, "content">): string {
  return contentText(message.content);
}

/** Return whether content contains any non-text part. */
export function hasMediaParts(content: MessageContent): boolean {
  return Array.isArray(content) && content.some((part) => part.type !== "text");
}

function partText(part: AssistantContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
    case "audio":
    case "video":
      return `[${part.type}${mediaTypeText(part.mediaType)} ${sourceDescriptor(part.source)}]`;
    case "file":
      return `[file${mediaTypeText(part.mediaType)}${part.filename ? ` ${quoteLabel(part.filename)}` : ""} ${sourceDescriptor(part.source)}]`;
    case "tool-call":
      return `[tool-call ${escapeBare(part.toolName)} ${escapeBare(part.toolCallId)}]`;
    case "reasoning":
      return `[reasoning] ${part.text}`;
  }
}

type MediaPartSource = Extract<
  ContentPart,
  { type: "image" | "audio" | "video" | "file" }
>["source"];

function sourceDescriptor(source: MediaPartSource): string {
  if (typeof source === "string") return stringSourceDescriptor(source);
  if (source instanceof URL) return escapeUrl(source.href);
  if (source instanceof Uint8Array) return bytesDescriptor(source);
  if (source instanceof ArrayBuffer) return bytesDescriptor(new Uint8Array(source));
  if (isBlob(source)) return blobDescriptor(source);
  switch (source.type) {
    case "data":
      return source.data instanceof Uint8Array
        ? bytesDescriptor(source.data)
        : blobDescriptor(source.data);
    case "url":
      return escapeUrl(source.url.href);
    case "provider-file":
      return `provider-file:${escapeBare(source.provider)}`;
  }
}

function stringSourceDescriptor(source: string): string {
  if (source.startsWith("data:")) return escapeUrl(source);
  return escapeUrl(source);
}

function mediaTypeText(mediaType: string | undefined): string {
  return mediaType ? ` ${escapeBare(mediaType)}` : "";
}

function bytesDescriptor(bytes: Uint8Array): string {
  return dataDescriptor(bytesToBase64(bytes));
}

function blobDescriptor(blob: Blob): string {
  return `${formatBytes(blob.size)}${blob.type ? ` ${escapeBare(blob.type)}` : ""} sha256:unavailable`;
}

function dataDescriptor(base64: string): string {
  const estimatedBytes = estimatedBase64Bytes(base64);
  if (estimatedBytes > MAX_DESCRIPTOR_HASH_BYTES) {
    return `${formatBytes(estimatedBytes)} sha256:omitted`;
  }
  const bytes = base64ToBytes(base64);
  return `${formatBytes(bytes.byteLength)} sha256:${sha256Hex(bytes).slice(0, 12)}`;
}

function estimatedBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${formatScaled(bytes / 1024)}KB`;
  return `${formatScaled(bytes / (1024 * 1024))}MB`;
}

function formatScaled(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function quoteLabel(value: string): string {
  return JSON.stringify(value);
}

function escapeBare(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}

function escapeUrl(url: string): string {
  return escapeBare(truncateDataUrl(url));
}

function truncateDataUrl(url: string): string {
  const match = /^data:([^;,]*)(?:[;,].*)?$/i.exec(url);
  return match ? `data:${match[1]}` : url;
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== "undefined" && value instanceof Blob;
}
