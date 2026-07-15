import { mcp, streamableHttp } from "@use-crux/mcp";

/** Per-invocation credentials used by the documented HTTP source. */
export interface ExampleRuntimeContext {
  readonly mcpToken: string;
}

/**
 * Create the Streamable HTTP source used by the MCP guide.
 *
 * The endpoint is injected so the executable documentation test can use an
 * in-process server while applications provide their production endpoint.
 */
export function createHttpExampleSource(url: string) {
  return mcp<ExampleRuntimeContext>({
    id: "catalog",
    transport: ({ runtimeContext, abortSignal }) => {
      if (abortSignal?.aborted) throw abortSignal.reason;
      return streamableHttp({
        url,
        headers: { Authorization: `Bearer ${runtimeContext.mcpToken}` },
      });
    },
    tools: { allow: ["lookup"], prefix: "catalog_" },
  });
}
