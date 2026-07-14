import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JsonValue, ToolModelOutput } from "@use-crux/core";

import { assertMcpResultBinaryParts } from "./binary";

type ModelContentPart = Extract<
  ToolModelOutput,
  { readonly type: "content" }
>["value"][number];

/** MCP content currently normalized for application and model consumption. */
export type McpContent =
  | {
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly type: "image";
      readonly data: string;
      readonly mimeType: string;
    }
  | {
      readonly type: "audio";
      readonly data: string;
      readonly mimeType: string;
    }
  | {
      readonly type: "resource";
      readonly resource:
        | {
            readonly uri: string;
            readonly text: string;
            readonly mimeType?: string;
          }
        | {
            readonly uri: string;
            readonly blob: string;
            readonly mimeType?: string;
          };
    }
  | {
      readonly type: "resource_link";
      readonly uri: string;
      readonly name: string;
      readonly description?: string;
      readonly mimeType?: string;
      readonly size?: number;
      readonly title?: string;
    };

/** Sanitized application-facing result of an MCP tool call. */
export interface McpToolResult {
  readonly content: readonly McpContent[];
  readonly structuredContent?: JsonValue;
  readonly isError?: boolean;
}

/** Validate and remove protocol-private metadata from an official client result. */
export function normalizeMcpToolResult(value: unknown): McpToolResult {
  assertMcpResultBinaryParts(value);
  const result = CallToolResultSchema.parse(value);
  return {
    content: result.content.map(copyContent),
    ...(result.structuredContent !== undefined
      ? { structuredContent: jsonValue(result.structuredContent) }
      : {}),
    ...(result.isError !== undefined ? { isError: result.isError } : {}),
  };
}

/** Convert a sanitized MCP result into canonical model-facing tool output. */
export function mcpToolModelOutput(result: McpToolResult): ToolModelOutput {
  if (result.isError) {
    return { type: "error-text", value: mcpErrorText(result) };
  }
  const content = result.content.flatMap(
    (part): readonly ModelContentPart[] => {
      switch (part.type) {
        case "text":
          return [{ type: "text", text: part.text }];
        case "image":
          return [
            {
              type: "image",
              source: decodeBase64(part.data),
              mediaType: part.mimeType,
            },
          ];
        case "audio":
          return [
            {
              type: "audio",
              source: decodeBase64(part.data),
              mediaType: part.mimeType,
            },
          ];
        case "resource":
          if ("text" in part.resource) {
            return [
              {
                type: "text",
                text: `Resource ${part.resource.uri}:\n${part.resource.text}`,
              },
            ];
          }
          return [
            { type: "text", text: `Resource ${part.resource.uri}:` },
            {
              type: "file",
              source: decodeBase64(part.resource.blob),
              ...(part.resource.mimeType
                ? { mediaType: part.resource.mimeType }
                : {}),
              ...(filenameFromUri(part.resource.uri)
                ? { filename: filenameFromUri(part.resource.uri) }
                : {}),
            },
          ];
        case "resource_link":
          return [{ type: "text", text: resourceLinkText(part) }];
      }
    },
  );
  if (content.length > 0) return { type: "content", value: content };
  if (result.structuredContent !== undefined) {
    return { type: "json", value: result.structuredContent };
  }
  return { type: "text", value: "" };
}

function mcpErrorText(result: McpToolResult): string {
  const messages = result.content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "image":
      case "audio":
        return `[${part.type}:${part.mimeType}]`;
      case "resource":
        return "text" in part.resource
          ? `Resource ${part.resource.uri}:\n${part.resource.text}`
          : `[resource:${part.resource.mimeType ?? "binary"}] ${part.resource.uri}`;
      case "resource_link":
        return resourceLinkText(part);
    }
  });
  if (messages.length > 0) return messages.join("\n");
  if (result.structuredContent !== undefined) {
    return JSON.stringify(result.structuredContent);
  }
  return "MCP tool reported an error.";
}

function copyContent(part: CallToolResult["content"][number]): McpContent {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "image":
      return { type: "image", data: part.data, mimeType: part.mimeType };
    case "audio":
      return { type: "audio", data: part.data, mimeType: part.mimeType };
    case "resource":
      return {
        type: "resource",
        resource:
          "text" in part.resource
            ? {
                uri: part.resource.uri,
                text: part.resource.text,
                ...(part.resource.mimeType
                  ? { mimeType: part.resource.mimeType }
                  : {}),
              }
            : {
                uri: part.resource.uri,
                blob: part.resource.blob,
                ...(part.resource.mimeType
                  ? { mimeType: part.resource.mimeType }
                  : {}),
              },
      };
    case "resource_link":
      return {
        type: "resource_link",
        uri: part.uri,
        name: part.name,
        ...(part.description ? { description: part.description } : {}),
        ...(part.mimeType ? { mimeType: part.mimeType } : {}),
        ...(part.size !== undefined ? { size: part.size } : {}),
        ...(part.title ? { title: part.title } : {}),
      };
  }
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function filenameFromUri(uri: string): string | undefined {
  try {
    const pathname = new URL(uri).pathname;
    const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
    return filename ? decodeURIComponent(filename) : undefined;
  } catch {
    return undefined;
  }
}

function resourceLinkText(
  link: Extract<McpContent, { readonly type: "resource_link" }>,
): string {
  const description = link.description ? ` — ${link.description}` : "";
  return `Resource link: ${link.name} (${link.uri})${description}`;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, jsonValue(item)]),
    );
  }
  throw new TypeError("MCP structuredContent must contain only JSON values.");
}
