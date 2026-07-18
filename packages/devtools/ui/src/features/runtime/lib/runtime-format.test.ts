import { describe, expect, it } from "vitest";
import {
  filterRuntimeWork,
  runtimeCountLabel,
  runtimeCountsByStatus,
} from "./runtime-format";
import type { RuntimeWorkRow } from "../types";

describe("runtime view filtering", () => {
  const rows: readonly RuntimeWorkRow[] = [
    runtimeWork({
      workId: "work_a",
      status: "blocked",
      namespace: "local",
      targetId: "review",
    }),
    runtimeWork({
      workId: "work_b",
      status: "pending",
      namespace: "prod",
      targetId: "embed",
    }),
    runtimeWork({
      workId: "work_c",
      status: "dead-letter",
      namespace: "local",
      targetId: "embed",
    }),
  ];

  it("filters work by status, namespace, and target", () => {
    expect(
      filterRuntimeWork(rows, {
        status: "dead-letter",
        namespace: "local",
        targetId: "embed",
      }).map((row) => row.workId),
    ).toEqual(["work_c"]);
  });

  it("rolls up status counts from server buckets and preserves truncation markers", () => {
    const counts = runtimeCountsByStatus([
      {
        namespace: "local",
        status: "pending",
        targetId: "review",
        count: 2000,
        truncated: true,
      },
      { namespace: "local", status: "pending", targetId: "embed", count: 3 },
      { namespace: "local", status: "blocked", targetId: "review", count: 1 },
    ]);

    expect(runtimeCountLabel(counts.get("pending"))).toBe("2003+");
    expect(runtimeCountLabel(counts.get("blocked"))).toBe("1");
    expect(runtimeCountLabel(counts.get("completed"))).toBe("0");
  });
});

function runtimeWork(
  row: Pick<RuntimeWorkRow, "workId" | "status" | "namespace" | "targetId">,
): RuntimeWorkRow {
  return {
    ...row,
    work: { kind: "task.run" },
    attempt: 1,
    maxAttempts: 8,
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
  };
}
