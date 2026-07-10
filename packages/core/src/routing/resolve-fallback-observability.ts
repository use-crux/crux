/**
 * Observability helpers for fallback routing resolution.
 *
 * Kept separate from the fallback attempt loop so the loop file stays focused
 * on recovery semantics.
 *
 * @module
 * @internal
 */

import { observe } from "../observability";
import { emitRoutingReceiptReport } from "./observability";
import type { RoutingReceipt } from "./receipt";

/** Emit a hook failure without allowing the hook to control fallback flow. */
export function emitRoutingHookError(
  span: ReturnType<typeof observe.openSpan>,
  hook: string,
  error: unknown,
): void {
  span.withContext(() => {
    observe.event({
      name: "routing.hook_error",
      attributes: {
        routingKind: "fallback",
        hook,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  });
}

/** Emit the single top-level routing report artifact for one fallback resolve. */
export function emitFallbackRoutingReport(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  preview: RoutingReceipt,
): void {
  emitRoutingReceiptReport(spanId, "routing.fallback", "fallback", preview);
}
