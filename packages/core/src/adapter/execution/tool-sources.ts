/**
 * Call-scoped tool-source materialization shared by execution dialects.
 *
 * @internal
 * @module
 */

import type { ResolvedPrompt } from "../../resolver/types";
import { observe } from "../../observability";
import {
  ToolSourceCollisionError,
  ToolSourceUnsupportedError,
  toolSourceSessionProvenance,
  type ToolSourceMaterializer,
  type ToolSourceSession,
} from "../../tools/tool-source";
import { createToolRegistry } from "../../tools/tool-registry";
import { withToolExposureProvenance } from "../tool/exposure/provenance";

/** A resolved prompt augmented with materialized tools and owned cleanup. */
export interface MaterializedToolSources {
  readonly resolved: ResolvedPrompt;
  /** Run subsequent provider/tool work under the source invocation context. */
  withContext<T>(fn: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Compatibility diagnostic for cleanup failures in lifecycle tests. */
export interface ToolSourceCleanupFailure {
  readonly sourceId: string;
  readonly kind: "error" | "timeout";
  readonly error?: unknown;
}

type CleanupFailureHook = (failure: ToolSourceCleanupFailure) => void;

const TOOL_SOURCE_CLEANUP_TIMEOUT_MS = 5_000;
let cleanupFailureHook: CleanupFailureHook | undefined;

/**
 * Install the internal cleanup diagnostic hook used by lifecycle tests.
 * Canonical source cleanup evidence is emitted independently. The returned
 * disposer restores the previous hook so tests cannot leak state.
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
    return {
      resolved: options.resolved,
      withContext: async (fn) => fn(),
      close: async () => {},
    };
  }

  if (!options.materialize) {
    throw new ToolSourceUnsupportedError(sources[0], options.dialect);
  }

  const sessions: Array<{
    readonly sourceId: string;
    readonly session: ToolSourceSession;
  }> = [];
  const tools = createToolRegistry(options.resolved.tools);
  const owners = new Map<string, string>(
    Object.keys(tools).map((name) => [name, "prompt-authored tools"] as const),
  );
  const ambientContext = observe.captureContext();
  const invocationRun = ambientContext
    ? undefined
    : observe.openRun({
        name: `${options.dialect} tool sources`,
        rootPrimitive: "run",
        attributes: {
          dialect: options.dialect,
          toolSourceCount: sources.length,
        },
      });
  const invocationContext = ambientContext ?? invocationRun?.captureContext();

  try {
    await observe.withContext(invocationContext, async () => {
      for (const source of sources) {
        const session = await options.materialize!(source, {
          runtimeContext: options.runtimeContext,
          abortSignal: options.abortSignal,
        });
        sessions.push({ sourceId: source.id, session });
        for (const [name, tool] of Object.entries(session.tools)) {
          const previousOwner = owners.get(name);
          if (previousOwner) {
            throw new ToolSourceCollisionError(name, source.id, previousOwner);
          }
          tools[name] = withToolExposureProvenance(tool, {
            kind: "discovered",
            sourceId: source.id,
            sourceKind: source.kind,
          });
          owners.set(name, `tool source "${source.id}"`);
        }
      }
    });
  } catch (error) {
    await observe.withContext(invocationContext, () => closeReverse(sessions));
    invocationRun?.error(error);
    throw error;
  }

  let closed = false;
  return {
    resolved: {
      ...options.resolved,
      ...(Object.keys(tools).length > 0 ? { tools } : {}),
    },
    async withContext<T>(fn: () => T | Promise<T>): Promise<T> {
      return await observe.withContext(invocationContext, fn);
    },
    async close() {
      if (closed) return;
      closed = true;
      await observe.withContext(invocationContext, () =>
        closeReverse(sessions),
      );
      invocationRun?.end();
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
    const startedAt = Date.now();
    try {
      await closeBounded(entry.session);
      emitCleanupEvent(entry.session, "ok", Date.now() - startedAt);
    } catch (error) {
      const outcome =
        error instanceof ToolSourceCleanupTimeoutError ? "timeout" : "error";
      emitCleanupEvent(entry.session, outcome, Date.now() - startedAt, error);
      reportCleanupFailure({
        sourceId: entry.sourceId,
        kind: outcome === "timeout" ? "timeout" : "error",
        ...(error instanceof ToolSourceCleanupTimeoutError ? {} : { error }),
      });
    }
  }
}

function emitCleanupEvent(
  session: ToolSourceSession,
  outcome: "ok" | "error" | "timeout",
  durationMs: number,
  error?: unknown,
): void {
  const provenance = toolSourceSessionProvenance(session)?.cleanupEvent;
  if (!provenance) return;
  try {
    observe.withContext(provenance.context, () => {
      observe.event({
        name: provenance.name,
        attributes: {
          ...provenance.attributes,
          outcome,
          durationMs,
          ...(outcome === "error"
            ? {
                errorCategory:
                  provenance.errorCategory?.(error) ?? "cleanup-error",
              }
            : outcome === "timeout"
              ? { errorCategory: "timeout" }
              : {}),
        },
      });
    });
  } catch {
    // Cleanup evidence is fail-open and never changes invocation control flow.
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
