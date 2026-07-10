import type { Message } from "../generation/messages";
import type { ContentPart, MessageContent } from "../types/content";
import { base64ToBytes, bytesToBase64 } from "./base64";
import { sha256Hex } from "./sha256";

const MAX_DESCRIPTOR_HASH_BYTES = 256 * 1024;

export { UnsupportedContentError } from "./errors";
export type { UnsupportedContentErrorOptions } from "./errors";
export {
  createInvalidMediaSourceError,
  createUnsupportedCapabilityError,
  isInvalidMediaSourceError,
  isUnsupportedCapabilityError,
} from "./media-errors";
export type {
  InvalidMediaSourceError,
  UnsupportedCapabilityError,
  UnsupportedCapabilityIssue,
} from "./media-errors";

/** Create a canonical text content part. */
export function textPart(text: string): ContentPart {
  return { type: "text", text };
}

/** Create a canonical image content part from base64/bytes or a URL. */
export function imagePart(input: ImagePartInput): ContentPart {
  if ("data" in input) {
    return {
      type: "image-data",
      data: base64Data(input.data),
      mediaType: input.mediaType,
    };
  }

  return {
    type: "image-url",
    url: String(input.url),
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
  };
}

/** Create a canonical file content part from base64/bytes or a URL. */
export function filePart(input: FilePartInput): ContentPart {
  if ("data" in input) {
    return {
      type: "file-data",
      data: base64Data(input.data),
      mediaType: input.mediaType,
      ...(input.filename ? { filename: input.filename } : {}),
    };
  }

  return {
    type: "file-url",
    url: String(input.url),
    ...(input.mediaType ? { mediaType: input.mediaType } : {}),
    ...(input.filename ? { filename: input.filename } : {}),
  };
}

/** Project canonical content into bounded text for string-only subsystems. */
export function contentText(content: MessageContent): string {
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

export type ImagePartInput =
  | {
      readonly data: string | Uint8Array | ArrayBuffer;
      readonly mediaType: string;
    }
  | { readonly url: string | URL; readonly mediaType?: string };

export type FilePartInput =
  | {
      readonly data: string | Uint8Array | ArrayBuffer;
      readonly mediaType: string;
      readonly filename?: string;
    }
  | {
      readonly url: string | URL;
      readonly mediaType?: string;
      readonly filename?: string;
    };

function partText(part: ContentPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image-data":
      return `[image ${escapeBare(part.mediaType)} ${dataDescriptor(part.data)}]`;
    case "image-url":
      return `[image${part.mediaType ? ` ${escapeBare(part.mediaType)}` : ""} ${escapeUrl(part.url)}]`;
    case "image-file-id":
      return `[image-file-id ${fileIdText(part.fileId)}]`;
    case "file-data":
      return `[file ${escapeBare(part.mediaType)}${part.filename ? ` ${quoteLabel(part.filename)}` : ""} ${dataDescriptor(part.data)}]`;
    case "file-url":
      return `[file${part.mediaType ? ` ${escapeBare(part.mediaType)}` : ""}${part.filename ? ` ${quoteLabel(part.filename)}` : ""} ${escapeUrl(part.url)}]`;
    case "file-id":
      return `[file-id ${fileIdText(part.fileId)}]`;
    case "custom":
      return "[custom]";
  }
}

function base64Data(data: string | Uint8Array | ArrayBuffer): string {
  if (typeof data === "string") return data;
  return bytesToBase64(
    data instanceof Uint8Array ? data : new Uint8Array(data),
  );
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

function fileIdText(fileId: string | Record<string, string>): string {
  return typeof fileId === "string"
    ? escapeBare(fileId)
    : JSON.stringify(fileId);
}
