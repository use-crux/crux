/**
 * Pure revision-comparison helpers for the Runs list's push-invalidation path.
 *
 * The server publishes `{ entity, id, revision }` on every observability
 * ingest commit (binding spec 04 §4). A client that already applied a
 * revision must ignore a repeat/stale notification instead of refetching;
 * a client that is behind fetches the bounded `/runs/delta` catch-up and
 * either patches forward or falls back to a full invalidate when the
 * server reports the delta window expired.
 */

import type { ObservabilityRunsDelta } from "@/types";

export type RevisionEventDecision = "ignore" | "catch-up";

/**
 * Decide whether a WS `ObservabilityEvent` revision is new information.
 * An event with no revision is treated conservatively as "catch up" —
 * silently ignoring an unversioned push would risk missing a change.
 */
export function decideOnObservabilityRevisionEvent(
  lastAppliedRevision: number,
  eventRevision: number | undefined,
): RevisionEventDecision {
  if (eventRevision == null) return "catch-up";
  return eventRevision > lastAppliedRevision ? "catch-up" : "ignore";
}

export type CatchUpAction = "noop" | "invalidate";

/**
 * Interpret a bounded `/runs/delta` response. `expired` means the client's
 * last-known revision fell outside the server's retained change log, so a
 * partial delta would be a lie — the caller must fully invalidate instead
 * of trusting an empty/partial `changes` list.
 */
export function catchUpActionFromDelta(
  delta: ObservabilityRunsDelta,
): CatchUpAction {
  if (delta.expired) return "invalidate";
  return delta.changes.length > 0 ? "invalidate" : "noop";
}
