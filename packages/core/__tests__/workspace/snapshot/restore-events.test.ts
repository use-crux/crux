import { afterEach, describe, expect, it, vi } from "vitest";
import {
  config,
  resetHooks,
  workspace,
  type WorkspaceChangeEvent,
} from "@use-crux/core";
import { inMemoryRuntimeStore, node } from "@use-crux/core/runtime";
import { createWorkspaceChangeEmitter } from "../../../src/workspace/watch/runtime";
import { controlledRecordStore } from "./fixtures";

afterEach(() => {
  resetHooks();
});

describe("workspace snapshot restore events", () => {
  it("emits no file changes for create, list, or explicit delete", async () => {
    config({
      runtime: node({
        namespace: "snapshot-lifecycle-events",
        autoStartMaintenance: false,
      }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: controlledRecordStore().store,
    });
    await ws.write("/outputs/report.md", "captured");
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await primeWatch(events);
      const snapshot = await ws.snapshot.create({ path: "/outputs" });
      await ws.snapshot.list({ path: "/outputs" });
      await ws.snapshot.delete(snapshot);
      await ws.write("/outputs/z-sentinel.md", "done");
      await waitForPath(events, "/outputs/z-sentinel.md");

      expect(events.map((event) => event.path)).toEqual([
        "/outputs/z-sentinel.md",
      ]);
    } finally {
      handle.stop();
    }
  });

  it("emits successful exact-tree changes in lexical path order", async () => {
    config({
      runtime: node({
        namespace: "snapshot-restore-events",
        autoStartMaintenance: false,
      }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: controlledRecordStore().store,
    });
    await ws.write("/outputs/a-create.md", "captured create");
    await ws.write("/outputs/b-replace.md", "captured replace");
    await ws.write("/outputs/c-unchanged.md", "captured unchanged");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.delete("/outputs/a-create.md");
    await ws.write("/outputs/b-replace.md", "later replace");
    await ws.write("/outputs/d-delete.md", "later delete");
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await primeWatch(events);
      await ws.snapshot.restore(snapshot);
      await ws.write("/outputs/z-sentinel.md", "done");
      await waitForPath(events, "/outputs/z-sentinel.md");

      expect(events.map(({ type, path }) => ({ type, path }))).toEqual([
        { type: "create", path: "/outputs/a-create.md" },
        { type: "update", path: "/outputs/b-replace.md" },
        { type: "delete", path: "/outputs/d-delete.md" },
        { type: "create", path: "/outputs/z-sentinel.md" },
      ]);
    } finally {
      handle.stop();
    }
  });

  it("emits no file changes when restore rolls back", async () => {
    config({
      runtime: node({
        namespace: "snapshot-restore-rollback-events",
        autoStartMaintenance: false,
      }),
    });
    const records = controlledRecordStore();
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: records.store,
    });
    await ws.write("/outputs/a.md", "captured-a");
    await ws.write("/outputs/b.md", "captured-b");
    const snapshot = await ws.snapshot.create({ path: "/outputs" });
    await ws.write("/outputs/a.md", "later-a");
    await ws.write("/outputs/b.md", "later-b");
    records.failPutWhen(
      (value) =>
        value._cruxWorkspaceFile === true &&
        value.path === "/outputs/b.md" &&
        value.inlineText === "captured-b",
      new Error("path two failed"),
    );
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await primeWatch(events);
      await expect(ws.snapshot.restore(snapshot)).rejects.toMatchObject({
        code: "backend_error",
      });
      await ws.write("/outputs/z-sentinel.md", "done");
      await waitForPath(events, "/outputs/z-sentinel.md");
      expect(events.map((event) => event.path)).toEqual([
        "/outputs/z-sentinel.md",
      ]);
    } finally {
      handle.stop();
    }
  });

  it("keeps a committed restore successful when event delivery fails", async () => {
    const runtimeStore = inMemoryRuntimeStore();
    config({
      runtime: node({
        namespace: "snapshot-restore-event-failure",
        store: runtimeStore,
        autoStartMaintenance: false,
      }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: controlledRecordStore().store,
    });
    await ws.write("/outputs/report.md", "captured");
    const snapshot = await ws.snapshot.create({ path: "/outputs/report.md" });
    await ws.write("/outputs/report.md", "later");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runtimeStore.testing.failAfter(0);

    try {
      await expect(ws.snapshot.restore(snapshot)).resolves.toMatchObject({
        restoredFiles: 1,
      });
      await expect(ws.read("/outputs/report.md")).resolves.toMatchObject({
        content: "captured",
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/emit change event/),
        expect.any(Error),
      );
    } finally {
      warn.mockRestore();
    }
  });
});

async function primeWatch(events: WorkspaceChangeEvent[]): Promise<void> {
  const path = "/outputs/watch-ready";
  await createWorkspaceChangeEmitter()({
    type: "create",
    workspaceId: "research",
    namespace: "thread:1",
    path,
  });
  await waitForPath(events, path);
  events.length = 0;
}

async function waitForPath(
  events: readonly WorkspaceChangeEvent[],
  path: string,
): Promise<void> {
  const started = Date.now();
  while (!events.some((event) => event.path === path)) {
    if (Date.now() - started > 10_000) {
      throw new Error(`Timed out waiting for Workspace event at ${path}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
