import { expect, it } from "vitest";
import {
  initialSessionStatistics,
  recordSessionStatistics,
  sessionStatistics,
} from "@use-crux/core/runtime/internal/session-store";

it("projects a persisted Session statistics ledger", () => {
  const statistics = recordSessionStatistics(
    initialSessionStatistics("session-1", new Date("2026-08-04T10:00:00Z")),
    "session-1",
    new Date("2026-08-04T10:00:02Z"),
    [{ kind: "timing", activeTimeMs: 500, suspendedTimeMs: 250 }],
  );

  expect(statistics.cursor).toBe(2);
  expect(sessionStatistics(statistics, "session-1").timing).toMatchObject({
    startedAt: new Date("2026-08-04T10:00:00Z"),
    updatedAt: new Date("2026-08-04T10:00:02Z"),
    wallTimeMs: 2_000,
    activeTimeMs: 500,
    suspendedTimeMs: 250,
  });
});

it("keeps Session statistics commit timestamps nondecreasing after restore", () => {
  const restored = recordSessionStatistics(
    initialSessionStatistics("session-1", new Date("2026-08-04T10:00:00Z")),
    "session-1",
    new Date("2026-08-04T10:00:05Z"),
    [{ kind: "timing", activeTimeMs: 100, suspendedTimeMs: 0 }],
  );

  // Durable hosts may supply a reconstructed/skewed clock earlier than the
  // ledger's last commit; append still records commit freshness monotonically.
  const next = recordSessionStatistics(
    restored,
    "session-1",
    new Date("2026-08-04T10:00:03Z"),
    [{ kind: "timing", activeTimeMs: 50, suspendedTimeMs: 0 }],
  );

  expect(next.cursor).toBe(3);
  expect(sessionStatistics(next, "session-1").timing).toMatchObject({
    startedAt: new Date("2026-08-04T10:00:00Z"),
    updatedAt: new Date("2026-08-04T10:00:05Z"),
    activeTimeMs: 150,
    suspendedTimeMs: 0,
  });
});
