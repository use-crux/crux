/** Secret-free MCP contract identity committed into durable approvals. */

import type { JsonValue } from "@use-crux/core";

import type { McpDiscoveredToolMetadata } from "./types";

/** Project discovered MCP metadata into Core's opaque replay identity. */
export function mcpApprovalReplayIdentity(
  metadata: McpDiscoveredToolMetadata,
): JsonValue {
  return {
    kind: "mcp",
    serverId: metadata.serverId,
    remoteName: metadata.remoteName,
    exposedName: metadata.exposedName,
    inputSchemaFingerprint: metadata.inputSchemaFingerprint,
  };
}
