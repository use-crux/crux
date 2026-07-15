import {
  mcpToolSourceContractError,
  type McpToolSourceErrorContext,
} from "./errors";

const MCP_REMOTE_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/u;
const PORTABLE_EXPOSED_TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/u;

/**
 * Validate the protocol name and Crux's cross-provider exposed name.
 *
 * The remote name remains unchanged for `tools/call`. Prefixing only derives
 * the model-facing name; incompatible names are never silently rewritten.
 */
export function assertMcpToolNames(
  remoteName: string,
  exposedName: string,
  errorContext: McpToolSourceErrorContext,
): void {
  if (!MCP_REMOTE_TOOL_NAME.test(remoteName)) {
    throw mcpToolSourceContractError(
      "filter",
      errorContext,
      `Invalid remote MCP tool name "${remoteName}". Remote names must match ` +
        "[A-Za-z0-9_.-]{1,128}.",
    );
  }
  if (!PORTABLE_EXPOSED_TOOL_NAME.test(exposedName)) {
    throw mcpToolSourceContractError(
      "filter",
      errorContext,
      `Exposed MCP tool name "${exposedName}" is not portable. Final names must ` +
        "match [A-Za-z_][A-Za-z0-9_-]{0,63}. Configure tools.prefix to fix " +
        "a leading digit when possible; otherwise rename the server tool.",
    );
  }
}
