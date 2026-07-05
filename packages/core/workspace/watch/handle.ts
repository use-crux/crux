/**
 * Runtime-backed workspace watch handle.
 *
 * @module
 */

import type { EventCursor } from "../../runtime/ports";
import { normalizePath } from "../path";
import {
  matchesWorkspaceWatchScope,
  workspaceChangeFromRuntimeEvent,
  type WorkspaceWatchScope,
} from "./events";
import { createWorkspaceWatchRuntime } from "./runtime";
import type {
  WorkspaceChangeEvent,
  WorkspaceWatchCallback,
  WorkspaceWatchHandle,
  WorkspaceWatchOptions,
} from "./types";

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_EVENT_LIMIT = 100;
const MAX_RETRY_DELAY_MS = 5_000;

/** Dependencies for creating a watch handle for one workspace instance. */
export interface CreateWorkspaceWatchHandleOptions {
  readonly workspaceId: string;
  readonly path: string;
  readonly options?: WorkspaceWatchOptions;
  readonly resolveNamespace: () => Promise<string>;
}

/** Create a `workspace.watch()` handle. */
export function createWorkspaceWatchHandle(
  input: CreateWorkspaceWatchHandleOptions,
): WorkspaceWatchHandle {
  const runtime = createWorkspaceWatchRuntime();
  const listeners = new Set<WorkspaceWatchCallback>();
  const createdAt = Date.now();
  const pollIntervalMs = Math.max(
    1,
    input.options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const limit = Math.max(1, input.options?.limit ?? DEFAULT_EVENT_LIMIT);
  let latestCursor = normalizeCursor(input.options?.cursor);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling = false;
  let stopped = false;
  let consecutiveFailures = 0;

  const handle: WorkspaceWatchHandle = Object.freeze({
    get cursor() {
      return latestCursor;
    },
    get stopped() {
      return stopped;
    },
    on(callback: WorkspaceWatchCallback) {
      if (stopped) return () => undefined;
      listeners.add(callback);
      schedule(0);
      return () => {
        listeners.delete(callback);
      };
    },
    stop,
  });

  if (input.options?.signal) {
    if (input.options.signal.aborted) {
      stop();
    } else {
      input.options.signal.addEventListener("abort", stop, { once: true });
    }
  }

  return handle;

  function schedule(delayMs = pollIntervalMs): void {
    if (stopped || listeners.size === 0 || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void poll();
    }, delayMs);
    timer.unref?.();
  }

  async function poll(): Promise<void> {
    if (stopped || polling || listeners.size === 0) return;
    polling = true;
    let nextDelayMs = pollIntervalMs;
    try {
      const namespace = await input.resolveNamespace();
      const scopePath = normalizePath(input.path);
      const scope: WorkspaceWatchScope = {
        workspaceId: input.workspaceId,
        namespace,
        path: scopePath,
        recursive: input.options?.recursive ?? scopePath === "/",
      };
      const result = await runtime.store.events.read({
        namespace: runtime.namespace,
        after: latestCursor,
        limit,
      });
      if (result.cursor) latestCursor = result.cursor;
      for (const runtimeEvent of result.events) {
        const event = workspaceChangeFromRuntimeEvent(runtimeEvent);
        if (!event) continue;
        if (!input.options?.cursor && event.at < createdAt) continue;
        if (matchesWorkspaceWatchScope(event, scope)) deliver(event);
      }
      consecutiveFailures = 0;
    } catch (error) {
      consecutiveFailures += 1;
      nextDelayMs = retryDelayMs(consecutiveFailures, pollIntervalMs);
      reportError(error, consecutiveFailures, nextDelayMs);
    } finally {
      polling = false;
      schedule(nextDelayMs);
    }
  }

  function deliver(event: WorkspaceChangeEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // Watch callbacks are user code; one listener must not stop delivery.
      }
    }
  }

  function reportError(
    error: unknown,
    failures: number,
    retryDelayMs: number,
  ): void {
    try {
      input.options?.onError?.({ error, failures, retryDelayMs });
    } catch {
      // Error observers are user code and must not stop retry scheduling.
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    listeners.clear();
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    input.options?.signal?.removeEventListener("abort", stop);
    runtime.dispose();
  }
}

function retryDelayMs(failures: number, baseDelayMs: number): number {
  const exponent = Math.min(failures - 1, 6);
  return Math.min(MAX_RETRY_DELAY_MS, baseDelayMs * 2 ** exponent);
}

function normalizeCursor(
  cursor: WorkspaceWatchOptions["cursor"] | undefined,
): EventCursor | undefined {
  return cursor as EventCursor | undefined;
}
