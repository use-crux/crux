import { describe, expect, it } from "vitest";
import {
  catchUpActionFromDelta,
  decideOnObservabilityRevisionEvent,
} from "./runs-revision";

describe("decideOnObservabilityRevisionEvent", () => {
  it("ignores an event revision already applied", () => {
    expect(decideOnObservabilityRevisionEvent(5, 5)).toBe("ignore");
  });

  it("ignores a stale event revision behind the applied revision", () => {
    expect(decideOnObservabilityRevisionEvent(5, 3)).toBe("ignore");
  });

  it("catches up when the event revision is newer", () => {
    expect(decideOnObservabilityRevisionEvent(5, 6)).toBe("catch-up");
  });

  it("catches up conservatively when the event carries no revision", () => {
    expect(decideOnObservabilityRevisionEvent(5, undefined)).toBe("catch-up");
  });
});

describe("catchUpActionFromDelta", () => {
  it("invalidates on an expired catch-up window", () => {
    expect(
      catchUpActionFromDelta({ revision: 10, changes: [], expired: true }),
    ).toBe("invalidate");
  });

  it("invalidates when the bounded delta reports real changes", () => {
    expect(
      catchUpActionFromDelta({
        revision: 10,
        changes: [{ entity: "run", id: "run_1", revision: 10 }],
        expired: false,
      }),
    ).toBe("invalidate");
  });

  it("is a no-op when the client is already current", () => {
    expect(
      catchUpActionFromDelta({ revision: 10, changes: [], expired: false }),
    ).toBe("noop");
  });

  it("invalidates on a deleted-run tombstone change, the same as any other change", () => {
    // The server (packages/local/internal/observability/revision.go) records
    // a deletion as a fresh RunChange for the deleted run id — there is no
    // separate "deleted" flag on the wire. From this function's perspective
    // that's just a non-empty, non-expired changes list: it must invalidate
    // so the client refetches the page and drops the now-gone row, instead
    // of caching a phantom run forever.
    expect(
      catchUpActionFromDelta({
        revision: 11,
        changes: [{ entity: "run", id: "run_deleted", revision: 11 }],
        expired: false,
      }),
    ).toBe("invalidate");
  });
});
