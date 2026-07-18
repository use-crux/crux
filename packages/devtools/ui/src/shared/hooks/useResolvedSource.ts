/**
 * React hooks for lazy source map resolution via the devtools server.
 *
 * All resolution happens server-side — these hooks just call the REST API
 * and cache results in module-scope Maps shared across all component instances.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  sourceResolverService,
  type ResolvedFnSource,
  type ResolvedLocation,
  type SourceLocation,
} from "@/shared/services/sourceResolver";
export type {
  ResolvedFnSource,
  ResolvedLocation,
  SourceLocation,
} from "@/shared/services/sourceResolver";

// ─── Module-scope caches ───

const locationCache = new Map<string, ResolvedLocation>();
const fnSourceCache = new Map<string, ResolvedFnSource | null>();

/** Pending batch: locations waiting to be resolved in the next microtask. */
let pendingBatch: Array<{ loc: SourceLocation; key: string }> = [];
let batchScheduled = false;
const batchListeners = new Set<() => void>();

function cacheKey(loc: SourceLocation): string {
  return `${loc.file}:${loc.line}:${loc.column ?? 0}`;
}

// ─── Batch scheduler ───

function scheduleBatch(): void {
  if (batchScheduled) return;
  batchScheduled = true;

  // Use microtask so all hooks in the same render cycle contribute to one batch
  queueMicrotask(async () => {
    batchScheduled = false;
    const batch = pendingBatch;
    pendingBatch = [];

    if (batch.length === 0) return;

    // Filter out already-cached entries
    const uncached = batch.filter((b) => !locationCache.has(b.key));
    if (uncached.length === 0) {
      // All were resolved by another batch while we waited
      for (const listener of batchListeners) listener();
      return;
    }

    // Deduplicate
    const uniqueMap = new Map<string, SourceLocation>();
    for (const { loc, key } of uncached) {
      if (!uniqueMap.has(key)) uniqueMap.set(key, loc);
    }

    try {
      const locations = await sourceResolverService.resolveSources([
        ...uniqueMap.values(),
      ]);
      if (locations) {
        const keys = [...uniqueMap.keys()];
        for (let i = 0; i < locations.length; i++) {
          locationCache.set(keys[i]!, locations[i]!);
        }
      }
    } catch {
      // Resolution failed — cache as unresolved so we don't retry
      for (const [key, loc] of uniqueMap) {
        locationCache.set(key, { ...loc, resolved: false });
      }
    }

    // Notify all listening hooks
    for (const listener of batchListeners) listener();
  });
}

// ─── Hooks ───

/**
 * Resolve a single source location. Returns the cached result immediately
 * if available, otherwise schedules a batch fetch and returns undefined.
 */
export function useResolvedSource(
  source: SourceLocation | undefined,
): ResolvedLocation | undefined {
  const [, forceUpdate] = useState(0);
  const listenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listenerRef.current = listener;
    batchListeners.add(listener);
    return () => {
      batchListeners.delete(listener);
    };
  }, []);

  if (!source) return undefined;

  const key = cacheKey(source);
  const cached = locationCache.get(key);
  if (cached) return cached;

  // Schedule for batch resolution
  pendingBatch.push({ loc: source, key });
  scheduleBatch();

  return undefined;
}

/**
 * Resolve multiple source locations in a single batch.
 * Useful for trace list views where many rows are visible at once.
 */
export function useResolvedSources(
  sources: Array<SourceLocation | undefined>,
): Array<ResolvedLocation | undefined> {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    batchListeners.add(listener);
    return () => {
      batchListeners.delete(listener);
    };
  }, []);

  const results: Array<ResolvedLocation | undefined> = [];

  for (const source of sources) {
    if (!source) {
      results.push(undefined);
      continue;
    }

    const key = cacheKey(source);
    const cached = locationCache.get(key);
    if (cached) {
      results.push(cached);
    } else {
      pendingBatch.push({ loc: source, key });
      results.push(undefined);
    }
  }

  if (pendingBatch.length > 0) scheduleBatch();

  return results;
}

/**
 * Lazily resolve a function's original source code.
 * Returns `undefined` while loading, `null` if resolution failed,
 * or the resolved source on success.
 */
export function useResolvedFnSource(
  file: string | undefined,
  line: number | undefined,
  column?: number,
): ResolvedFnSource | null | undefined {
  const [result, setResult] = useState<ResolvedFnSource | null | undefined>(
    undefined,
  );
  const keyRef = useRef<string>("");

  const fetch_ = useCallback(async () => {
    if (!file || line == null) return;

    const key = `fn:${file}:${line}:${column ?? 0}`;
    if (key === keyRef.current) return;
    keyRef.current = key;

    const cached = fnSourceCache.get(key);
    if (cached !== undefined) {
      setResult(cached);
      return;
    }

    setResult(undefined); // loading

    try {
      const value = await sourceResolverService.resolveFnSource({
        file,
        line,
        column,
      });
      fnSourceCache.set(key, value);
      setResult(value);
    } catch {
      fnSourceCache.set(key, null);
      setResult(null);
    }
  }, [file, line, column]);

  useEffect(() => {
    fetch_();
  }, [fetch_]);

  return result;
}
