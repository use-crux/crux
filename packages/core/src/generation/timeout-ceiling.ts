/**
 * Eval-owned timeout ceiling identity and provider-neutral clamp algebra.
 *
 * @internal
 * @module
 */

import { normalizeBudgetMs, toolBudgetMs } from "./timeout-budget";
import type { TimeoutOptions } from "./timeout-options";

const EVAL_TIMEOUT_CEILING_MARKER = Symbol.for(
  "@use-crux/core/EvalTaskTimeout",
);
const NESTED_TIMEOUT_KEYS = [
  "stepMs",
  "chunkMs",
  "firstToken",
  "toolMs",
] as const;

/**
 * Mark a fresh timeout object as an Eval-owned nested ceiling.
 *
 * The marker is intentionally non-enumerable and survives only when callers
 * pass the exact object. This function mutates only the fresh internal object
 * supplied by the task-context normalizer.
 */
export function markEvalTimeoutCeilingForInternalUse<
  Timeout extends TimeoutOptions,
>(timeout: Timeout): Timeout {
  Object.defineProperty(timeout, EVAL_TIMEOUT_CEILING_MARKER, { value: true });
  return timeout;
}

/** Return whether a timeout object retains Eval ceiling ownership. */
export function isEvalTimeoutCeilingForInternalUse(
  value: unknown,
): value is TimeoutOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, EVAL_TIMEOUT_CEILING_MARKER) === true
  );
}

/**
 * Clamp a production timeout against one marked Eval nested ceiling.
 *
 * Production resolution happens first. Positive Eval values impose an upper
 * bound; missing or disabled Eval values preserve the production value.
 * Named Tool budgets are clamped after each side resolves its own `toolMs`
 * fallback.
 */
export function clampEvalTimeoutCeilingForInternalUse(
  production: TimeoutOptions | undefined,
  ceiling: TimeoutOptions,
): TimeoutOptions | undefined {
  if (production === undefined && Object.keys(ceiling).length === 0) {
    return undefined;
  }

  const clamped = NESTED_TIMEOUT_KEYS.reduce<Record<string, unknown>>(
    (resolved, key) => {
      if (!Object.hasOwn(ceiling, key)) return resolved;
      const ceilingMs = normalizeBudgetMs(ceiling[key]);
      if (ceilingMs === undefined) return resolved;
      const productionMs = normalizeBudgetMs(production?.[key]);
      return {
        ...resolved,
        [key]:
          productionMs === undefined
            ? ceilingMs
            : Math.min(productionMs, ceilingMs),
      };
    },
    { ...(production ?? {}) },
  );
  const tools = clampToolBudgets(production, ceiling, clamped);
  return Object.freeze({
    ...clamped,
    ...(tools === undefined ? {} : { tools }),
  }) as TimeoutOptions;
}

/** Apply ordinary replacement or marked-ceiling semantics to one override. */
export function resolveTimeoutOverrideForInternalUse(
  production: TimeoutOptions | undefined,
  override: TimeoutOptions,
): TimeoutOptions {
  return isEvalTimeoutCeilingForInternalUse(override)
    ? (clampEvalTimeoutCeilingForInternalUse(production, override) ??
        Object.freeze({}))
    : override;
}

function clampToolBudgets(
  production: TimeoutOptions | undefined,
  ceiling: TimeoutOptions,
  clamped: Readonly<Record<string, unknown>>,
): Readonly<Record<string, number | null>> | undefined {
  const names = [
    ...new Set([
      ...Object.keys(production?.tools ?? {}),
      ...Object.keys(ceiling.tools ?? {}),
    ]),
  ];
  const resolved = names.reduce<Record<string, number | null>>(
    (tools, name) => {
      const ceilingMs = toolBudgetMs(ceiling, name);
      if (ceilingMs === undefined) {
        return production?.tools !== undefined &&
          Object.hasOwn(production.tools, name)
          ? { ...tools, [name]: production.tools[name] ?? null }
          : tools;
      }
      const productionMs = toolBudgetMs(production, name);
      return {
        ...tools,
        [name]:
          productionMs === undefined
            ? ceilingMs
            : Math.min(productionMs, ceilingMs),
      };
    },
    {},
  );

  if (Object.keys(resolved).length > 0) return Object.freeze(resolved);
  return "tools" in clamped && clamped.tools !== undefined
    ? Object.freeze({
        ...(clamped.tools as Readonly<Record<string, number | null>>),
      })
    : undefined;
}
