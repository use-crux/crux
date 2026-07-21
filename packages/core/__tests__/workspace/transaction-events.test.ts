import { afterEach, describe, expect, it } from "vitest";
import {
  config,
  inMemoryRecordStore,
  resetHooks,
  workspace,
  type WorkspaceChangeEvent,
} from "@use-crux/core";
import { node } from "@use-crux/core/runtime";
import { failLiveNamespacePut } from "./transaction-test-helpers";

afterEach(() => {
  resetHooks();
});

describe("workspace transaction events", () => {
  it("emits target changes in lexical order only after a successful batch", async () => {
    config({
      runtime: node({
        namespace: "transaction-events",
        autoStartMaintenance: false,
      }),
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: inMemoryRecordStore(),
    });
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      await ws.transaction(async (tx) => {
        await tx.write("/outputs/z.md", "z");
        await tx.write("/outputs/a.md", "a");
      });
      await ws.write("/outputs/sentinel.md", "done");
      await waitForPath(events, "/outputs/sentinel.md");

      expect(events.map((event) => event.path)).toEqual([
        "/outputs/a.md",
        "/outputs/z.md",
        "/outputs/sentinel.md",
      ]);
      expect(
        events.every((event) => !event.namespace.includes("__crux_tx_")),
      ).toBe(true);
    } finally {
      handle.stop();
    }
  });

  it("drops every buffered target change when a batch rolls back", async () => {
    config({
      runtime: node({
        namespace: "transaction-rollback-events",
        autoStartMaintenance: false,
      }),
    });
    const records = inMemoryRecordStore();
    const guarded = failLiveNamespacePut(records, {
      workspaceId: "research",
      namespace: "thread:1",
      onAttempt: 2,
    });
    const ws = workspace({
      id: "research",
      namespace: "thread:1",
      records: guarded.records,
    });
    const handle = ws.watch("/", { recursive: true, pollIntervalMs: 5 });
    const events: WorkspaceChangeEvent[] = [];
    handle.on((event) => events.push(event));

    try {
      guarded.enable();
      await expect(
        ws.transaction(async (tx) => {
          await tx.write("/outputs/a.md", "a");
          await tx.write("/outputs/b.md", "b");
        }),
      ).rejects.toThrow(/commit write failed/);
      await ws.write("/outputs/sentinel.md", "done");
      await waitForPath(events, "/outputs/sentinel.md");

      expect(events.map((event) => event.path)).toEqual([
        "/outputs/sentinel.md",
      ]);
    } finally {
      handle.stop();
    }
  });
});

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
