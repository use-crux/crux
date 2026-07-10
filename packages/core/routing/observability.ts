/**
 * Shared observability helpers for routing primitives.
 *
 * Routing spans and receipt artifacts are a cross-runtime contract: the
 * TypeScript runtime emits them, and local/devtools projects them into turn
 * decision reports. Keep those shapes centralized so wrapper implementations
 * cannot drift.
 *
 * @module
 * @internal
 */

import type { Deadline } from "../generation/timeout";
import { observe } from "../observability";
import type { RoutingReceipt } from "./receipt";

/** Routing primitive kinds used in shared span attributes. */
export type RoutingObservabilityKind =
  | "router"
  | "split"
  | "retry"
  | "fallback"
  | "cascade";

/** Return shared attributes required on every routing span start. */
export function routingSpanAttributes(
  kind: RoutingObservabilityKind,
  deadline: Deadline,
): Record<string, unknown> {
  return {
    routingKind: kind,
    deadlineRemainingMs: deadline.remaining() ?? null,
  };
}

/** Emit the one canonical receipt artifact for an outermost routing resolve. */
export function emitRoutingReceiptReport(
  spanId: ReturnType<typeof observe.openSpan>["spanId"],
  primitive: `routing.${RoutingObservabilityKind}`,
  routingKind: RoutingObservabilityKind,
  receipt: RoutingReceipt,
): void {
  const artifactId = observe.artifact({
    kind: "routing.report",
    contentType: "application/json",
    encoding: "json",
    preview: receipt,
    attributes: {
      primitive,
      routingKind,
    },
  });
  if (!artifactId) return;
  observe.edge({
    edgeType: "produced",
    from: { kind: "span", id: spanId },
    to: { kind: "artifact", id: artifactId },
    attributes: { primitive, routingKind },
  });
}

/** Emit the required routing mid-stream failure event on the active span. */
export function emitRoutingMidStreamFailure(
  span: ReturnType<typeof observe.openSpan>,
  attributes: Record<string, unknown>,
): void {
  span.withContext(() => {
    observe.event({
      name: "routing.mid_stream_failure",
      attributes,
    });
  });
}
