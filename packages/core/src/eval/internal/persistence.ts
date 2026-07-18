/** Terminal Eval run persistence projection. @internal */

import { REDACTED } from "../../shared/redaction";
import { redactAssertionOutcomes } from "./assertions/outcomes";
import {
  applyRedaction,
  DEFAULT_EVAL_PERSISTENCE_POLICY,
  sanitizeEvalSnapshot,
  truncateOutput,
  type EvalPersistencePolicy,
} from "./redact";
import type { EvalRun } from "./types";

/** Sanitize every authored/provider snapshot before a terminal run is written. */
export function sanitizeEvalRunForPersistence(
  run: EvalRun,
  policy: EvalPersistencePolicy = DEFAULT_EVAL_PERSISTENCE_POLICY,
): EvalRun {
  return Object.freeze({
    ...run,
    cells: Object.freeze(
      run.cells.map((cell) =>
        Object.freeze({
          ...cell,
          input: applyRedaction(cell.input, policy.redactPaths),
          ...(cell.call !== undefined
            ? {
                call: applyRedaction(cell.call, policy.redactPaths) as Readonly<
                  Record<string, unknown>
                >,
              }
            : {}),
          ...(cell.output !== undefined
            ? { output: sanitizeEvalSnapshot(cell.output, policy) }
            : {}),
          ...(cell.expected !== undefined
            ? { expected: sanitizeEvalSnapshot(cell.expected, policy) }
            : {}),
          response: undefined,
          ...persistedResponse(cell.response, policy),
          ...(cell.error !== undefined
            ? {
                error: Object.freeze({
                  ...cell.error,
                  message: redactDiagnosticText(cell.error.message),
                }),
              }
            : {}),
          scores: Object.freeze(
            cell.scores.map((score) =>
              Object.freeze({
                ...score,
                ...("rationale" in score && score.rationale !== undefined
                  ? { rationale: redactDiagnosticText(score.rationale) }
                  : {}),
                ...("message" in score && score.message !== undefined
                  ? { message: redactDiagnosticText(score.message) }
                  : {}),
              }),
            ),
          ),
          assertions: Object.freeze({
            ...cell.assertions,
            outcomes: Object.freeze(
              redactAssertionOutcomes(
                cell.assertions.outcomes,
                policy.redactPaths,
              ),
            ),
          }),
        }),
      ),
    ),
  }) as EvalRun;
}

function persistedResponse(
  response: EvalRun["cells"][number]["response"],
  policy: EvalPersistencePolicy,
):
  | { readonly response?: never; readonly responseOmitted?: never }
  | { readonly response: NonNullable<typeof response> }
  | {
      readonly responseOmitted: "persistence_size_limit" | "persistence_unsafe";
    } {
  if (response === undefined) return {};
  try {
    if (!isLosslessJsonValue(response)) {
      return { responseOmitted: "persistence_unsafe" };
    }
    const redacted = applyRedaction(
      response,
      policy.redactPaths,
    ) as NonNullable<typeof response>;
    return truncateOutput(redacted).truncated
      ? { responseOmitted: "persistence_size_limit" }
      : { response: redacted };
  } catch {
    return { responseOmitted: "persistence_unsafe" };
  }
}

function isLosslessJsonValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && !Object.is(value, -0);
  }
  if (typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (
        !Object.hasOwn(value, index) ||
        !isLosslessJsonValue(value[index], seen)
      ) {
        return false;
      }
    }
    return true;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return (
      descriptor !== undefined &&
      descriptor.enumerable &&
      "value" in descriptor &&
      isLosslessJsonValue(descriptor.value, seen)
    );
  });
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/giu, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu, REDACTED);
}
