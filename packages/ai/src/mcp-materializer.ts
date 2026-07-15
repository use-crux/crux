/**
 * Lazy optional-peer bridge from the AI SDK execution dialect to MCP.
 *
 * Keeping the import inside the materializer means ordinary AI SDK prompts do
 * not resolve or initialize `@use-crux/mcp`. Core remains protocol-agnostic;
 * only this provider-owned boundary recognizes the `mcp` source kind.
 *
 * @internal
 * @module
 */

import type {
  ToolSource,
  ToolSourceMaterializationContext,
  ToolSourceSession,
} from "@use-crux/core/tools";

/** Materialize one MCP source through `@ai-sdk/mcp` on demand. */
export async function materializeAiSdkToolSource(
  source: ToolSource,
  context: ToolSourceMaterializationContext,
): Promise<ToolSourceSession> {
  if (source.kind !== "mcp") {
    throw new Error(
      `The AI SDK execution dialect cannot materialize tool source kind "${source.kind}".`,
    );
  }

  try {
    const integration = await import("@use-crux/mcp");
    return integration.materializeAiSdkMcpToolSource(source, context);
  } catch (error) {
    if (isMissingMcpIntegration(error)) {
      throw new Error(
        'MCP tool sources with @use-crux/ai require the optional peer "@use-crux/mcp". Install @use-crux/mcp and retry.',
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
