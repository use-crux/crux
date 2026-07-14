/** Closed relation vocabulary for authored MCP Project Index facts. */
export const mcpRelationDeclarations = [
  "prompt.uses_mcp_server",
  "context.uses_mcp_server",
  "mcp.server.provides_tool",
] as const;

/** Data-only first-party MCP primitive declaration. */
export const authoredMcpPrimitiveManifest = Object.freeze({
  version: 1,
  definitions: Object.freeze([
    Object.freeze({
      kind: "mcp.server",
      calls: Object.freeze(["mcp"] as const),
      identity: "authored-id",
      fields: Object.freeze(["serverId", "transport", "tools"] as const),
    }),
    Object.freeze({
      kind: "tool",
      provenance: "authored-expected",
      identity: "final-exposed-name",
      fields: Object.freeze(["toolName", "mcp"] as const),
    }),
  ]),
  relations: mcpRelationDeclarations,
  nativeProjection: Object.freeze({
    static: Object.freeze({ frontend: "oxc", mode: "manifest" }),
    semantic: Object.freeze({ backend: "tsgo", mode: "manifest" }),
  }),
});
