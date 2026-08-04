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
