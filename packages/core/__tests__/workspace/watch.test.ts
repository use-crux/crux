import { afterEach, describe, expect, it } from "vitest";
import { config, inMemoryRecordStore, resetRuntime, workspace } from "@use-crux/core";
import { node } from "@use-crux/core/runtime";
import type { WorkspaceChangeEvent } from "../../workspace";

afterEach(() => {
  resetRuntime();
});

describe("workspace watch", () => {
  it("requires a runtime-backed durable event store", () => {
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });

    expect(() => ws.watch()).toThrow(/RUNTIME_REQUIRED/);
  });

  it("delivers create and update events through the runtime event cursor", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });
    const handle = ws.watch("/outputs", {
      recursive: true,
      pollIntervalMs: 5,
    });

    try {
      const create = once(handle);
      await ws.write("/outputs/report.md", "# Draft");
      await expect(create).resolves.toMatchObject({
        type: "create",
        workspaceId: "research",
        namespace: "thread:default",
        path: "/outputs/report.md",
      });

      const update = once(handle);
      await ws.write("/outputs/report.md", "# Final");
      await expect(update).resolves.toMatchObject({
        type: "update",
        path: "/outputs/report.md",
      });
    } finally {
      handle.stop();
    }
  });

  it("isolates namespaces and supports unsubscribe", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:a",
      records: inMemoryRecordStore(),
    });
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    const off = handle.on((event) => events.push(event));

    try {
      await ws.write("/outputs/other.md", "ignored", {
        namespace: "thread:b",
      });
      await waitForPoll();
      expect(events).toHaveLength(0);

      await ws.write("/outputs/a.md", "seen");
      await waitForEvents(events, 1);
      expect(events[0]).toMatchObject({
        type: "create",
        namespace: "thread:a",
        path: "/outputs/a.md",
      });

      off();
      await ws.write("/outputs/off.md", "not delivered");
      await waitForPoll();
      expect(events).toHaveLength(1);
    } finally {
      handle.stop();
    }
  });

  it("delivers rename, delete, copy, finalize, and transaction commit events", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await ws.write("/outputs/report.md", "# Draft", {
        status: "draft",
        kind: "report",
      });
      await waitForEvents(events, 1);

      await ws.rename("/outputs/report.md", "/outputs/renamed.md");
      await waitForEvents(events, 2);
      expect(events[1]).toMatchObject({
        type: "rename",
        from: "/outputs/report.md",
        path: "/outputs/renamed.md",
      });

      await ws.copy("/outputs/renamed.md", "/outputs/copy.md");
      await waitForEvents(events, 3);
      expect(events[2]).toMatchObject({
        type: "create",
        path: "/outputs/copy.md",
      });

      await ws.finalize("/outputs/copy.md");
      await waitForEvents(events, 4);
      expect(events[3]).toMatchObject({
        type: "update",
        path: "/outputs/copy.md",
      });

      await ws.delete("/outputs/renamed.md");
      await waitForEvents(events, 5);
      expect(events[4]).toMatchObject({
        type: "delete",
        path: "/outputs/renamed.md",
      });

      await ws.transaction(async (tx) => {
        await tx.write("/outputs/tx-a.md", "a");
        await tx.write("/outputs/tx-b.md", "b");
      });
      await waitForEvents(events, 7);
      expect(events.slice(5).map((event) => event.path).sort()).toEqual([
        "/outputs/tx-a.md",
        "/outputs/tx-b.md",
      ]);
      expect(events.every((event) => !event.namespace.includes("__crux_tx_")))
        .toBe(true);
    } finally {
      handle.stop();
    }
  });
});

function once(handle: {
  on(callback: (event: WorkspaceChangeEvent) => void): () => void;
}): Promise<WorkspaceChangeEvent> {
  return new Promise((resolve) => {
    const off = handle.on((event) => {
      off();
      resolve(event);
    });
  });
}

async function waitForEvents(
  events: readonly WorkspaceChangeEvent[],
  count: number,
): Promise<void> {
  await eventually(() => {
    expect(events.length).toBeGreaterThanOrEqual(count);
  });
}

async function waitForPoll(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

async function eventually(assert: () => void, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      assert();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("timed out waiting for assertion");
}
