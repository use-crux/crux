/**
 * Internal execution metadata context.
 *
 * This is deliberately not an observability/span-parenting API. Canonical
 * run/span parenting belongs to `@use-crux/core/observability` via `observe`.
 * The execution context only carries SDK metadata that flows and helpers need
 * while code is running: session id, flow id, parent flow id, and step labels.
 */

import { createAsyncScopeFacet } from "../async-scope";

export interface ExecutionContext {
  traceId?: string;
  sessionId?: string;
  flowId?: string;
  parentFlowId?: string;
  stepId?: string;
  stepLabel?: string;
}

const executionContextScope = createAsyncScopeFacet<ExecutionContext>(
  "core.execution-context",
);

export function runWithExecutionContext<R>(
  ctx: ExecutionContext,
  fn: () => R,
): R {
  return executionContextScope.run(ctx, fn);
}

export function getExecutionContext(): ExecutionContext | undefined {
  return executionContextScope.current();
}

export function withSession<T>(sessionId: string, fn: () => T): T {
  const existing = getExecutionContext();
  return runWithExecutionContext({ ...existing, sessionId }, fn);
}

export function createSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
