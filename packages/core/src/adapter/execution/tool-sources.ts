/**
 * Call-scoped tool-source materialization shared by execution dialects.
 *
 * @internal
 * @module
 */

import type { ResolvedPrompt } from "../../resolver/types";
import {
  ToolSourceCollisionError,
  ToolSourceUnsupportedError,
  type ToolSourceMaterializer,
  type ToolSourceSession,
} from "../../tools/tool-source";

/** A resolved prompt augmented with materialized tools and owned cleanup. */
export interface MaterializedToolSources {
  readonly resolved: ResolvedPrompt;
  close(): Promise<void>;
}

/** Internal cleanup failure evidence used until canonical MCP records land. */
export interface ToolSourceCleanupFailure {
  readonly sourceId: string;
  readonly kind: "error" | "timeout";
  readonly error?: unknown;
}

type CleanupFailureHook = (failure: ToolSourceCleanupFailure) => void;

const TOOL_SOURCE_CLEANUP_TIMEOUT_MS = 5_000;
let cleanupFailureHook: CleanupFailureHook | undefined;

/**
 * Install the temporary internal cleanup evidence hook used by lifecycle tests.
 *
 * Phase 8 replaces this seam with canonical observability records. The
 * returned disposer restores the previous hook so tests cannot leak state.
 *
 * @internal
 */
export function setToolSourceCleanupFailureHook(
  hook: CleanupFailureHook | undefined,
): () => void {
  const previous = cleanupFailureHook;
  cleanupFailureHook = hook;
  return () => {
    cleanupFailureHook = previous;
  };
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

  const sessions: Array<{
    readonly sourceId: string;
    readonly session: ToolSourceSession;
  }> = [];
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
      sessions.push({ sourceId: source.id, session });
      for (const [name, tool] of Object.entries(session.tools)) {
        const previousOwner = owners.get(name);
        if (previousOwner) {
          throw new ToolSourceCollisionError(name, source.id, previousOwner);
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
  sessions: readonly {
    readonly sourceId: string;
    readonly session: ToolSourceSession;
  }[],
): Promise<void> {
  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const entry = sessions[index];
    if (!entry) continue;
    try {
      await closeBounded(entry.session);
    } catch (error) {
      reportCleanupFailure({
        sourceId: entry.sourceId,
        kind:
          error instanceof ToolSourceCleanupTimeoutError ? "timeout" : "error",
        ...(error instanceof ToolSourceCleanupTimeoutError ? {} : { error }),
      });
    }
  }
}

function reportCleanupFailure(failure: ToolSourceCleanupFailure): void {
  try {
    cleanupFailureHook?.(failure);
  } catch {
    // Cleanup evidence must never change invocation control flow.
  }
}

async function closeBounded(session: ToolSourceSession): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(session.close()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ToolSourceCleanupTimeoutError()),
          TOOL_SOURCE_CLEANUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class ToolSourceCleanupTimeoutError extends Error {
  override readonly name = "ToolSourceCleanupTimeoutError";

  constructor() {
    super(`Tool source cleanup exceeded ${TOOL_SOURCE_CLEANUP_TIMEOUT_MS}ms.`);
  }
}
