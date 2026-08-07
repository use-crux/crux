import type { DeferredCallback } from "../types";
import { CruxDeferError } from "../errors";
import { resolveDiagnosticsOnlyDeferRegistration } from "./registration";

/** Settlement of source-internal diagnostics-only callback work. */
export type DiagnosticsOnlyDeferredWorkHandle =
  | {
      readonly status: "deferred";
      readonly settled: Promise<void>;
    }
  | {
      readonly status: "captured";
      readonly settled: Promise<void>;
    }
  | {
      readonly status: "inline";
      readonly settled: Promise<void>;
    };

/**
 * Schedule internal callback work with diagnostics-only evidence.
 *
 * Returns `deferred` when a retained execution scope accepted the callback,
 * `captured` when the active scope recorded intent without execution, and
 * `inline` when the callback started immediately as a safe fallback. Callers
 * that require correctness must await `settled` for `inline`; callers may
 * retain `settled` to implement an explicit flush boundary.
 *
 * This source-internal port has no evidence/visibility option and no package
 * export. Public authoring must use `defer()`.
 *
 * @internal
 */
export function scheduleDiagnosticsOnlyDeferredCallback(
  callback: DeferredCallback,
): DiagnosticsOnlyDeferredWorkHandle {
  return (
    tryScheduleDiagnosticsOnlyDeferredCallback(callback) ??
    startInline(callback)
  );
}

/** Attempt diagnostics-only scheduling without the correctness-oriented inline fallback. */
export function tryScheduleDiagnosticsOnlyDeferredCallback(
  callback: DeferredCallback,
): DiagnosticsOnlyDeferredWorkHandle | undefined {
  const registration = resolveDiagnosticsOnlyDeferRegistration();
  if (!registration) return undefined;

  let resolveSettlement!: () => void;
  let rejectSettlement!: (error: unknown) => void;
  const settled = new Promise<void>((resolve, reject) => {
    resolveSettlement = resolve;
    rejectSettlement = reject;
  });
  observeRejection(settled);

  try {
    const status = registration.scope.registerInline(
      async () => {
        try {
          await callback();
          resolveSettlement();
        } catch (error) {
          rejectSettlement(error);
          throw error;
        }
      },
      { ...registration, evidence: "diagnostics-only" },
    );
    if (status === "captured") resolveSettlement();
    return Object.freeze({ status, settled });
  } catch (error) {
    if (isKnownRegistrationInability(error)) return undefined;
    throw error;
  }
}

function startInline(
  callback: DeferredCallback,
): DiagnosticsOnlyDeferredWorkHandle {
  const settled = Promise.resolve().then(callback);
  observeRejection(settled);
  return Object.freeze({ status: "inline", settled });
}

function observeRejection(settled: Promise<void>): void {
  void settled.catch(() => undefined);
}

function isKnownRegistrationInability(error: unknown): boolean {
  return (
    error instanceof CruxDeferError &&
    (error.code === "DEFER_CAPABILITY_MISSING" ||
      error.code === "DEFER_LIMIT_EXCEEDED" ||
      error.code === "DEFER_SCOPE_SEALED")
  );
}
