import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  inMemoryRecordStore,
  resetHooks,
  workspace,
} from "@use-crux/core";
import { node } from "@use-crux/core/runtime";
import { createWorkspaceWatchHandle } from "../../workspace/watch/handle";
import { createWorkspaceChangeEmitter } from "../../workspace/watch/runtime";
import type {
  WorkspaceChangeEvent,
  WorkspaceCustomMountSource,
} from "../../workspace";

afterEach(() => {
  resetHooks();
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

  it("reports retryable poll failures without stopping the watch", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const failures: number[] = [];
    let namespaceAttempts = 0;
    const handle = createWorkspaceWatchHandle({
      workspaceId: "research",
      path: "/outputs",
      resolveNamespace: async () => {
        namespaceAttempts += 1;
        if (namespaceAttempts <= 2) {
          throw new Error(`namespace unavailable ${namespaceAttempts}`);
        }
        return "thread:default";
      },
      options: {
        pollIntervalMs: 5,
        onError: ({ failures: count }) => {
          failures.push(count);
        },
      },
    });
    const off = handle.on(() => undefined);

    try {
      await eventually(() => {
        expect(failures).toEqual([1, 2]);
      });
      await eventually(() => {
        expect(namespaceAttempts).toBeGreaterThan(2);
      });
      expect(handle.stopped).toBe(false);
    } finally {
      off();
      handle.stop();
    }
  });

  it("treats non-recursive root watches as direct-child watches", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
    });
    const implicitRoot = ws.watch({ recursive: false, pollIntervalMs: 5 });
    const explicitRoot = ws.watch("/", {
      recursive: false,
      pollIntervalMs: 5,
    });
    const implicitEvents: WorkspaceChangeEvent[] = [];
    const explicitEvents: WorkspaceChangeEvent[] = [];
    implicitRoot.on((event) => implicitEvents.push(event));
    explicitRoot.on((event) => explicitEvents.push(event));
    const emitChange = createWorkspaceChangeEmitter();

    try {
      await emitChange({
        type: "create",
        workspaceId: "research",
        namespace: "thread:default",
        path: "/outputs",
      });
      await waitForEvents(implicitEvents, 1);
      await waitForEvents(explicitEvents, 1);

      await emitChange({
        type: "create",
        workspaceId: "research",
        namespace: "thread:default",
        path: "/outputs/nested.md",
      });
      await waitForPoll();

      expect(implicitEvents.map((event) => event.path)).toEqual(["/outputs"]);
      expect(explicitEvents.map((event) => event.path)).toEqual(["/outputs"]);
    } finally {
      implicitRoot.stop();
      explicitRoot.stop();
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

  it("does not emit delete events for missing source-backed files", async () => {
    config({
      runtime: node({ namespace: "test-watch", autoStartMaintenance: false }),
    });
    const deleted: string[] = [];
    const source: WorkspaceCustomMountSource = {
      kind: "custom",
      exists: async () => false,
      read: async () => null,
      delete: async (path) => {
        deleted.push(path);
      },
    };
    const ws = workspace({
      id: "research",
      namespace: "thread:default",
      records: inMemoryRecordStore(),
      mounts: [
        {
          path: "/sources",
          access: "readwrite",
          source,
        },
      ],
    });
    const handle = ws.watch("/sources", {
      recursive: true,
      pollIntervalMs: 5,
    });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await ws.delete("/sources/missing.md");
      await waitForPoll();

      expect(deleted).toEqual(["/sources/missing.md"]);
      expect(events).toEqual([]);
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
  await delay(100);
}

async function eventually(assert: () => void, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  let attempts = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      assert();
      return;
    } catch (error) {
      lastError = error;
      attempts += 1;
      await delay(Math.min(100, 25 + attempts * 5));
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("timed out waiting for assertion");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
