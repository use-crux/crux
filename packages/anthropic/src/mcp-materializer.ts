/**
 * Lazy optional-peer bridge from the Anthropic execution dialect to MCP.
 *
 * Ordinary Anthropic prompts never resolve `@use-crux/mcp`; only an authored
 * MCP source reaches this provider-owned boundary. Materialized tools then use
 * Anthropic's normal request codec and Core's ordinary tool lifecycle.
 *
 * @internal
 * @module
 */

import type {
  ToolSource,
  ToolSourceMaterializationContext,
  ToolSourceSession,
} from "@use-crux/core/tools";

/** Materialize one MCP source through the shared official-client path. */
export async function materializeAnthropicToolSource(
  source: ToolSource,
  context: ToolSourceMaterializationContext,
): Promise<ToolSourceSession> {
  if (source.kind !== "mcp") {
    throw new Error(
      `The Anthropic execution dialect cannot materialize tool source kind "${source.kind}".`,
    );
  }

  try {
    const integration = await import("@use-crux/mcp");
    return integration.materializeMcpToolSource(source, context);
  } catch (error) {
    if (isMissingMcpIntegration(error)) {
      throw new Error(
        'MCP tool sources with @use-crux/anthropic require the optional peer "@use-crux/mcp". Install @use-crux/mcp and retry.',
        { cause: error },
      );
    }
    throw error;
  }
}

function isMissingMcpIntegration(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { readonly code?: string }).code;
  return (
    code === "ERR_MODULE_NOT_FOUND" && error.message.includes("@use-crux/mcp")
  );
}
