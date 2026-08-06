/** Shared Session close/kill/delete/fork lifecycle laws for adapter harnesses. */

import { expect, it } from "vitest";
import type { RunSessionConformanceTestsOptions } from "./types";

/**
 * Register close, kill, delete, and fork laws every Runtime Session store must obey.
 *
 * @remarks Close deactivates Signal subscriptions at the barrier and rejects
 * ingress. Kill is terminal for send. Delete clears Thread ownership. Fork is
 * idempotent with immutable lineage. Nested causal Work trees beyond pending
 * counters are not asserted here.
 */
export function registerSessionLifecycleConformance(
  options: RunSessionConformanceTestsOptions,
): void {
  it("closes parked Sessions, rejects ingress, then unregisters owners on delete", async () => {
    const harness = await options.createHarness("lifecycle-close-delete");
    try {
      const conversation = await harness.create("lifecycle-key");
      await conversation.close();
      await expect(conversation.status()).resolves.toMatchObject({
        state: "closed",
        pendingInputs: 0,
        pendingWork: 0,
      });
      await expect(
        conversation.send({ message: "after-close" }),
      ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
      // Duplicate close joins the same terminal closed state.
      await expect(conversation.close()).resolves.toBeUndefined();
      await expect(harness.ownerIds(conversation.thread.id)).resolves.toEqual([
        conversation.id,
      ]);
      await conversation.delete();
      await expect(harness.ownerIds(conversation.thread.id)).resolves.toEqual(
        [],
      );
      await expect(harness.create("lifecycle-key")).rejects.toMatchObject({
        code: "SESSION_TOMBSTONED",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("kills to a terminal closed projection and rejects later ingress", async () => {
    const harness = await options.createHarness("lifecycle-kill");
    try {
      const conversation = await harness.create("kill-key");
      await conversation.kill();
      await expect(conversation.status()).resolves.toMatchObject({
        state: "closed",
      });
      await expect(
        conversation.send({ message: "after-kill" }),
      ).rejects.toMatchObject({ code: "SESSION_CLOSED" });
      await expect(conversation.kill()).resolves.toBeUndefined();
      await expect(harness.ownerIds(conversation.thread.id)).resolves.toEqual([
        conversation.id,
      ]);
      await conversation.delete();
      await expect(harness.ownerIds(conversation.thread.id)).resolves.toEqual([]);
    } finally {
      await harness.dispose();
    }
  });

  it("forks an independent child Session with immutable lineage and retry safety", async () => {
    const harness = await options.createHarness("lifecycle-fork");
    try {
      const parent = await harness.create("fork-parent");
      const child = await parent.fork();
      expect(child.id).not.toBe(parent.id);
      expect(child.forkedFrom?.sessionId).toBe(parent.id);
      await expect(harness.ownerIds(parent.thread.id)).resolves.toEqual(
        expect.arrayContaining([parent.id, child.id]),
      );
      // Idempotent retry of the same fork barrier reuses the deterministic child.
      const again = await parent.fork();
      expect(again.id).toBe(child.id);
      const accepted = await child.send({ message: "child" });
      expect(accepted.cursor).toBe("1");
      await expect(parent.forks()).resolves.toEqual([
        expect.objectContaining({ sessionId: child.id }),
      ]);
    } finally {
      await harness.dispose();
    }
  });
}
