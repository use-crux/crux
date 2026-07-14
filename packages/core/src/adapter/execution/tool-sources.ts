/**
 * Call-scoped tool-source materialization shared by execution dialects.
 *
 * @internal
 * @module
 */

import type { ResolvedPrompt } from "../../resolver/types";
import {
  ToolSourceUnsupportedError,
  type ToolSourceMaterializer,
  type ToolSourceSession,
} from "../../tools/tool-source";

/** A resolved prompt augmented with materialized tools and owned cleanup. */
export interface MaterializedToolSources {
  readonly resolved: ResolvedPrompt;
  close(): Promise<void>;
}

/**
 * Materialize sources in declaration order and merge their tools.
 *
 * Prompt-authored/source and source/source name collisions fail closed.
 * Call-site tools are merged later by `createToolLifecycle()` and intentionally
 * retain their existing final-word precedence.
 */
export async function materializeToolSources(options: {
  readonly dialect: string;
  readonly resolved: ResolvedPrompt;
  readonly materialize: ToolSourceMaterializer | undefined;
  readonly runtimeContext: unknown;
  readonly abortSignal?: AbortSignal;
}): Promise<MaterializedToolSources> {
  const sources = options.resolved.toolSources ?? [];
  if (sources.length === 0) {
    return { resolved: options.resolved, close: async () => {} };
  }

  if (!options.materialize) {
    throw new ToolSourceUnsupportedError(sources[0], options.dialect);
  }

  const sessions: ToolSourceSession[] = [];
  const tools: Record<string, unknown> = { ...(options.resolved.tools ?? {}) };
  const owners = new Map<string, string>(
    Object.keys(tools).map((name) => [name, "prompt-authored tools"] as const),
  );

  try {
    for (const source of sources) {
      const session = await options.materialize(source, {
        runtimeContext: options.runtimeContext,
        abortSignal: options.abortSignal,
      });
      sessions.push(session);
      for (const [name, tool] of Object.entries(session.tools)) {
        const previousOwner = owners.get(name);
        if (previousOwner) {
          throw new Error(
            `Tool name collision for "${name}" between ${previousOwner} and tool source "${source.id}". ` +
              "Configure an explicit source prefix.",
          );
        }
        tools[name] = tool;
        owners.set(name, `tool source "${source.id}"`);
      }
    }
  } catch (error) {
    await closeReverse(sessions);
    throw error;
  }

  let closed = false;
  return {
    resolved: {
      ...options.resolved,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    },
    async close() {
      if (closed) return;
      closed = true;
      await closeReverse(sessions);
    },
  };
}

async function closeReverse(
  sessions: readonly ToolSourceSession[],
): Promise<void> {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    try {
      await sessions[index]?.close();
    } catch {
      // Cleanup evidence is added with canonical MCP observability in phase 8.
      // A cleanup failure must never replace an earlier primary failure.
    }
  }
}
