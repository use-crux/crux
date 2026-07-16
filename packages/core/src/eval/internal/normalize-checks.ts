/** Normalize callback declarations and timing Gates without invoking user code. */

import type { EvalDefinitionV1, NormalizedEvalCheck } from "./definition";

/** Normalize an ordinary or explicitly fresh callback into planner metadata. */
export function normalizeEvalCheck(
  value: unknown,
  label: string,
): NormalizedEvalCheck {
  if (typeof value === "function") {
    return Object.freeze({ check: value as never, requiresFresh: false });
  }
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { readonly fresh?: unknown }).fresh === true &&
    typeof (value as { readonly check?: unknown }).check === "function"
  ) {
    return Object.freeze({
      check: (value as { readonly check: NormalizedEvalCheck["check"] }).check,
      requiresFresh: true,
    });
  }
  throw new TypeError(
    `evaluate(): ${label} must be a callback or { fresh: true, check: callback }.`,
  );
}

/** Normalize Gates and reject latency policy that cannot produce a result. */
export function normalizeEvalGates(
  value: unknown,
): EvalDefinitionV1["gates"] | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("evaluate(): `gates` must be an object.");
  }
  const gates = value as Readonly<Record<string, unknown>>;
  if (gates.latency === undefined) return Object.freeze({ ...gates });
  if (
    gates.latency === null ||
    typeof gates.latency !== "object" ||
    Array.isArray(gates.latency)
  ) {
    throw latencyGateError();
  }
  const latency = gates.latency as Readonly<Record<string, unknown>>;
  const thresholds = [
    ["meanMs", latency.meanMs],
    ["p95Ms", latency.p95Ms],
  ] as const;
  if (thresholds.every(([, threshold]) => threshold === undefined)) {
    throw latencyGateError();
  }
  for (const [name, threshold] of thresholds) {
    if (
      threshold !== undefined &&
      (typeof threshold !== "number" || !Number.isFinite(threshold))
    ) {
      throw new TypeError(
        `evaluate(): \`gates.latency.${name}\` must be a finite number.`,
      );
    }
  }
  return Object.freeze({
    ...gates,
    latency: Object.freeze({ ...latency }),
  });
}

function latencyGateError(): TypeError {
  return new TypeError(
    "evaluate(): `gates.latency` must declare `meanMs` or `p95Ms`.",
  );
}
