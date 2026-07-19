import { describe, expect, it } from "vitest";
import { decodeFlowSnapshot } from "../src/runtime/codec";

describe("Postgres Runtime snapshot codec", () => {
  it("revives pending flow timeout deadlines", () => {
    const deadline = new Date("2026-07-18T01:00:00.000Z");
    const snapshot = decodeFlowSnapshot({
      flow_id: "flow_timeout",
      work_id: "work_timeout",
      target_id: "review",
      namespace: "tenant-a",
      status: "suspended",
      input: {},
      completed_steps: {},
      fingerprint: [],
      pending_suspends: [
        { label: "approval", timeoutAt: deadline.toISOString() },
      ],
      delivered_suspends: null,
      scheduled_work: null,
      updated_at: deadline.toISOString(),
    });

    expect(snapshot.pendingSuspends[0]?.timeoutAt).toEqual(deadline);
  });
});
