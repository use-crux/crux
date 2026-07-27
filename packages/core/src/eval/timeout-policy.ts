/**
 * Canonical normalization and resolution for authored Eval timeout policies.
 *
 * @internal
 * @module
 */

import { normalizeBudgetMs, type TimeoutOptions } from "../generation/timeout";
import type { EvalTaskTimeout } from "./task-context";

const EVAL_TASK_TIMEOUT_MARKER = Symbol.for("@use-crux/core/EvalTaskTimeout");
const SCALAR_TIMEOUT_KEYS = [
  "totalMs",
  "stepMs",
  "chunkMs",
  "firstToken",
  "toolMs",
] as const;
const TIMEOUT_KEYS: readonly string[] = [...SCALAR_TIMEOUT_KEYS, "tools"];

/** Frozen, semantic representation of one authored Eval timeout policy. */
export type NormalizedEvalTimeoutPolicy = Readonly<TimeoutOptions>;

/** One cell's full outer deadline and marked nested timeout ceiling. */
export interface ResolvedEvalTimeoutPolicy {
  /** Eval-owned whole-cell deadline, when authored or explicitly cleared. */
  readonly totalMs?: number | null;
  /** Privately marked nested ceiling forwarded through the task context. */
  readonly nested: EvalTaskTimeout;
}

/**
 * Validate and canonicalize one authored Eval or Case timeout value.
 *
 * Positive finite values are floored to integer milliseconds. Explicit
 * disabled numbers and `null` canonicalize to `null`; missing stays absent.
 */
export function normalizeEvalTimeoutPolicy(
  value: unknown,
  source = "Eval timeout",
): NormalizedEvalTimeoutPolicy | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isRecord(value)) {
    throw new TypeError(`${source} must be a timeout object or null.`);
  }
  for (const key of Object.keys(value)) {
    if (!TIMEOUT_KEYS.includes(key)) {
      throw new TypeError(`${source} contains unknown option \`${key}\`.`);
    }
  }

  const normalized = Object.fromEntries(
    SCALAR_TIMEOUT_KEYS.flatMap((key) =>
      value[key] === undefined
        ? []
        : [[key, normalizeTimeoutValue(value[key], `${source}.${key}`)]],
    ),
  ) as Record<(typeof SCALAR_TIMEOUT_KEYS)[number], number | null>;
  const tools = normalizeTools(value.tools, source);

  return Object.freeze({
    ...normalized,
    ...(tools === undefined ? {} : { tools }),
  });
}

/** Resolve one immutable effective policy from normalized Eval and Case data. */
export function resolveEvalTimeoutPolicy(
  inherited: NormalizedEvalTimeoutPolicy | null | undefined,
  authored: NormalizedEvalTimeoutPolicy | null | undefined,
): ResolvedEvalTimeoutPolicy {
  const full =
    authored === null
      ? clearInheritedPolicy(inherited)
      : mergePolicies(inherited, authored);
  const nested = markEvalTaskTimeout(projectNestedPolicy(full));

  return Object.freeze({
    ...(Object.hasOwn(full, "totalMs") ? { totalMs: full.totalMs } : {}),
    nested,
  });
}

/**
 * Project a resolved policy into frozen, marker-free fingerprint material.
 *
 * The outer `totalMs` remains distinct while resolving, then rejoins the
 * nested fields only in this data-only representation.
 */
export function projectResolvedEvalTimeoutPolicy(
  resolved: ResolvedEvalTimeoutPolicy,
): NormalizedEvalTimeoutPolicy {
  const tools =
    resolved.nested.tools === undefined
      ? undefined
      : Object.freeze({ ...resolved.nested.tools });
  return Object.freeze({
    ...(Object.hasOwn(resolved, "totalMs")
      ? { totalMs: resolved.totalMs }
      : {}),
    ...resolved.nested,
    ...(tools === undefined ? {} : { tools }),
  });
}

/** Add the private non-enumerable ownership marker to a frozen nested copy. */
export function markEvalTaskTimeout(timeout: EvalTaskTimeout): EvalTaskTimeout {
  const tools =
    timeout.tools === undefined
      ? undefined
      : Object.freeze({ ...timeout.tools });
  const marked = {
    ...timeout,
    ...(tools === undefined ? {} : { tools }),
  };
  Object.defineProperty(marked, EVAL_TASK_TIMEOUT_MARKER, { value: true });
  return Object.freeze(marked);
}

function mergePolicies(
  inherited: NormalizedEvalTimeoutPolicy | null | undefined,
  authored: NormalizedEvalTimeoutPolicy | undefined,
): NormalizedEvalTimeoutPolicy {
  const base = inherited ?? {};
  const override = authored ?? {};
  const scalars = Object.fromEntries(
    SCALAR_TIMEOUT_KEYS.flatMap((key) =>
      Object.hasOwn(override, key)
        ? [[key, override[key]]]
        : Object.hasOwn(base, key)
          ? [[key, base[key]]]
          : [],
    ),
  );
  const tools = mergeTools(base.tools, override.tools);
  return Object.freeze({
    ...scalars,
    ...(tools === undefined ? {} : { tools }),
  });
}

function clearInheritedPolicy(
  inherited: NormalizedEvalTimeoutPolicy | null | undefined,
): NormalizedEvalTimeoutPolicy {
  if (inherited === undefined || inherited === null) return Object.freeze({});
  const scalars = Object.fromEntries(
    SCALAR_TIMEOUT_KEYS.flatMap((key) =>
      Object.hasOwn(inherited, key) ? [[key, null]] : [],
    ),
  );
  const tools =
    inherited.tools === undefined
      ? undefined
      : Object.freeze(
          Object.fromEntries(
            Object.keys(inherited.tools)
              .sort(compareCodepoint)
              .map((name) => [name, null]),
          ),
        );
  return Object.freeze({
    ...scalars,
    ...(tools === undefined ? {} : { tools }),
  });
}

function projectNestedPolicy(
  full: NormalizedEvalTimeoutPolicy,
): EvalTaskTimeout {
  const { totalMs: _totalMs, ...nested } = full;
  return nested;
}

function normalizeTools(
  value: unknown,
  source: string,
): Readonly<Record<string, number | null>> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new TypeError(`${source}.tools must be a timeout record.`);
  }
  return Object.freeze(
    Object.fromEntries(
      Object.keys(value)
        .sort(compareCodepoint)
        .map((name) => [
          name,
          normalizeTimeoutValue(value[name], `${source}.tools.${name}`),
        ]),
    ),
  );
}

function mergeTools(
  inherited: Readonly<Record<string, number | null>> | undefined,
  authored: Readonly<Record<string, number | null>> | undefined,
): Readonly<Record<string, number | null>> | undefined {
  if (inherited === undefined && authored === undefined) return undefined;
  return Object.freeze(
    Object.fromEntries(
      Object.entries({ ...inherited, ...authored }).sort(([left], [right]) =>
        compareCodepoint(left, right),
      ),
    ),
  );
}

function normalizeTimeoutValue(value: unknown, source: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new TypeError(`${source} must be a number or null.`);
  }
  return normalizeBudgetMs(value) ?? null;
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
