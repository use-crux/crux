import type {
  McpStdioTransportConfig,
  McpStreamableHttpTransportConfig,
  McpToolSelection,
  McpTransportConfig,
} from "./index";

/** Structured, payload-free failure for invalid public MCP configuration. */
export class McpConfigurationError extends TypeError {
  readonly code = "MCP_CONFIGURATION_ERROR" as const;

  constructor(
    readonly api: "mcp()" | "stdio()" | "streamableHttp()",
    readonly field: string,
    message: string,
  ) {
    super(`${api}: ${message}.`);
    this.name = "McpConfigurationError";
  }
}

/** Validate a widened or deserialized transport at the materialization edge. */
export function assertMcpTransportConfig(
  value: unknown,
  api: McpConfigurationError["api"] = "mcp()",
  prefix = "transport",
): asserts value is McpTransportConfig {
  const config = requireRecord(value, api, prefix);
  if (config.type === "stdio") {
    assertStdioConfig(config, api, prefix);
    return;
  }
  if (config.type === "streamable-http") {
    assertStreamableHttpConfig(config, api, prefix);
    return;
  }
  invalid(
    api,
    `${prefix}.type`,
    `${prefix}.type must be "stdio" or "streamable-http"`,
  );
}

/** Validate the optional allow/deny/prefix selection without coercion. */
export function assertMcpToolSelection(
  value: unknown,
): asserts value is McpToolSelection {
  const selection = requireRecord(value, "mcp()", "tools");
  assertAllowedKeys(selection, ["allow", "deny", "prefix"], "mcp()", "tools");
  if (selection.allow !== undefined && selection.deny !== undefined) {
    throw new McpConfigurationError(
      "mcp()",
      "tools",
      "tools.allow and tools.deny are mutually exclusive",
    );
  }
  assertStringArray(selection.allow, "mcp()", "tools.allow");
  assertStringArray(selection.deny, "mcp()", "tools.deny");
  if (selection.prefix !== undefined && typeof selection.prefix !== "string") {
    invalid("mcp()", "tools.prefix", "tools.prefix must be a string");
  }
}

/** Validate and narrow stdio helper input. */
export function assertStdioConfig(
  value: unknown,
  api: McpConfigurationError["api"] = "stdio()",
  prefix = "",
): asserts value is Omit<McpStdioTransportConfig, "type"> {
  const config = requireRecord(value, api, prefix || "config");
  const field = (name: string) => (prefix ? `${prefix}.${name}` : name);
  assertAllowedKeys(
    config,
    prefix
      ? ["type", "command", "args", "cwd", "env"]
      : ["command", "args", "cwd", "env"],
    api,
    prefix,
  );
  if (typeof config.command !== "string" || !config.command.trim()) {
    invalid(
      api,
      field("command"),
      `${field("command")} must be a non-empty string`,
    );
  }
  assertStringArray(config.args, api, field("args"));
  if (config.cwd !== undefined && typeof config.cwd !== "string") {
    invalid(api, field("cwd"), `${field("cwd")} must be a string`);
  }
  assertStringRecord(config.env, api, field("env"));
}

/** Validate and narrow Streamable HTTP helper input. */
export function assertStreamableHttpConfig(
  value: unknown,
  api: McpConfigurationError["api"] = "streamableHttp()",
  prefix = "",
): asserts value is Omit<McpStreamableHttpTransportConfig, "type"> {
  const config = requireRecord(value, api, prefix || "config");
  const field = (name: string) => (prefix ? `${prefix}.${name}` : name);
  assertAllowedKeys(
    config,
    prefix
      ? ["type", "url", "headers", "redirect"]
      : ["url", "headers", "redirect"],
    api,
    prefix,
  );
  if (typeof config.url !== "string" && !(config.url instanceof URL)) {
    invalid(api, field("url"), `${field("url")} must be a string or URL`);
  }
  assertStringRecord(config.headers, api, field("headers"));
  if (
    config.redirect !== undefined &&
    config.redirect !== "error" &&
    config.redirect !== "follow"
  ) {
    invalid(
      api,
      field("redirect"),
      `${field("redirect")} must be "error" or "follow"`,
    );
  }
}

function requireRecord(
  value: unknown,
  api: McpConfigurationError["api"],
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(api, field, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertStringArray(
  value: unknown,
  api: McpConfigurationError["api"],
  field: string,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) invalid(api, field, `${field} must be an array`);
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      invalid(api, `${field}[${index}]`, `${field} entries must be strings`);
    }
  }
}

function assertStringRecord(
  value: unknown,
  api: McpConfigurationError["api"],
  field: string,
): void {
  if (value === undefined) return;
  const record = requireRecord(value, api, field);
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      invalid(api, `${field}.${key}`, `${field} values must be strings`);
    }
  }
}

function assertAllowedKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  api: McpConfigurationError["api"],
  prefix: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      const field = prefix ? `${prefix}.${key}` : key;
      invalid(api, field, `${field} is not supported`);
    }
  }
}

function invalid(
  api: McpConfigurationError["api"],
  field: string,
  message: string,
): never {
  throw new McpConfigurationError(api, field, message);
}
