/**
 * Private result-finalization capability carried by middleware continuations.
 *
 * The capability stays on the `next` function so runtime middleware arguments
 * remain provider-neutral and public middleware cannot depend on Crux's
 * operation-lifecycle machinery.
 *
 * @module
 * @internal
 */

import type { OperationResultMeta } from "../../observability";
import { withOperationResultMeta } from "../../observability/internal/result-meta";
import type { MiddlewareResult, PromptMiddleware } from "../types";

type PromptMiddlewareNext = Parameters<PromptMiddleware>[1];
type MiddlewareResultFinalizer = (
  result: MiddlewareResult,
) => MiddlewareResult;

const middlewareResultFinalizer: unique symbol = Symbol(
  "crux.middlewareResultFinalizer",
);

type InternalMiddlewareNext = PromptMiddlewareNext & {
  readonly [middlewareResultFinalizer]?: MiddlewareResultFinalizer;
};

/** Capture and freeze the operation identity exposed by an open span handle. */
export function captureOperationResultMeta(
  operation: OperationResultMeta,
): OperationResultMeta {
  return Object.freeze({
    traceId: operation.traceId,
    spanId: operation.spanId,
  });
}

/** Attach an owning operation's finalizer to a middleware continuation. */
export function attachMiddlewareResultFinalizer(
  next: PromptMiddlewareNext,
  finalizer: MiddlewareResultFinalizer,
): PromptMiddlewareNext {
  Object.defineProperty(next, middlewareResultFinalizer, {
    value: finalizer,
  });
  return next;
}

/**
 * Create the root continuation that converts an adapter payload into the
 * owning operation's observed middleware result before resolving.
 */
export function createFinalizingMiddlewareNext<
  TArgs extends Record<string, unknown>,
  TResult extends object,
>(
  doGenerate: (args: TArgs) => Promise<TResult>,
  operation: OperationResultMeta,
): PromptMiddlewareNext {
  const finalizeResult: MiddlewareResultFinalizer = (result) =>
    withOperationResultMeta(result, operation);

  return attachMiddlewareResultFinalizer(
    async (args) =>
      finalizeResult(
        (await doGenerate(args.preparedArgs as TArgs)) as MiddlewareResult,
      ),
    finalizeResult,
  );
}

/** Finalize a result when the downstream continuation carries the capability. */
export function finalizeMiddlewareResult(
  next: PromptMiddlewareNext,
  result: MiddlewareResult,
): MiddlewareResult {
  const finalizer = (next as InternalMiddlewareNext)[middlewareResultFinalizer];
  return finalizer ? finalizer(result) : result;
}
