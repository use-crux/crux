/** Durable owner and owner-head behaviors for canonical Threads. */

import { expect, it } from "vitest";
import type { RecordStore } from "../../storage";
import { ThreadInUseError } from "../errors";
import { registerThreadOwner } from "../owner";
import { createThreadHandle, thread } from "../thread";
import type { ErasureConformanceOptions } from "./erasure-conformance";

/** Register owner durability and independently selected owner-head behaviors. */
export function registerThreadOwnerConformance(
  options: ErasureConformanceOptions,
): void {
  it("durably registers owners, accepts identical registration, and rejects state conflicts", async () => {
    const storage = await options.prepare();
    await registerThreadOwner(storage, "owner-registration", {
      id: "session-a",
      state: "open",
    });
    const before = await storage.records.get("thread/owner-registration");
    expect(before).toMatchObject({
      state: "live",
      owners: { "session-a": "open" },
    });

    await expect(
      registerThreadOwner(storage, "owner-registration", {
        id: "session-a",
        state: "open",
      }),
    ).resolves.toBeUndefined();
    expect(await storage.records.get("thread/owner-registration")).toEqual(
      before,
    );
    await expect(
      registerThreadOwner(storage, "owner-registration", {
        id: "session-a",
        state: "closed",
      }),
    ).rejects.toMatchObject({ code: "identity_conflict" });
  });

  it("rejects owner registration after deletion", async () => {
    const storage = await options.prepare();
    await thread({ id: "deleted-owner", storage }).delete();
    await expect(
      registerThreadOwner(storage, "deleted-owner", {
        id: "session-a",
        state: "open",
      }),
    ).rejects.toMatchObject({ code: "deleted" });
  });

  it("rejects standalone deletion for every durably registered owner state", async () => {
    for (const state of ["open", "closed"] as const) {
      const storage = await options.prepare();
      await registerThreadOwner(storage, `reconstructed-${state}`, {
        id: `${state}-session`,
        state,
      });
      await expect(
        thread({
          id: `reconstructed-${state}`,
          storage,
        }).delete(),
      ).rejects.toBeInstanceOf(ThreadInUseError);
    }
  });

  it("serializes owner registration with deletion publication", async () => {
    const storage = await options.prepare();
    const backing = storage.records;
    let release = (): void => {};
    let started = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    let pause = true;
    const records: RecordStore = {
      ...backing,
      async mutate(key, fn) {
        return backing.mutate!(key, async (current) => {
          if (key === "thread/owner-delete-race" && pause) {
            pause = false;
            started();
            await held;
          }
          return fn(current);
        });
      },
    };
    const ownedStorage = { ...storage, records };
    const registration = registerThreadOwner(
      ownedStorage,
      "owner-delete-race",
      {
        id: "session-a",
        state: "open",
      },
    );
    await entered;
    const deletion = thread({
      id: "owner-delete-race",
      storage: ownedStorage,
    }).delete();
    release();
    await registration;
    await expect(deletion).rejects.toBeInstanceOf(ThreadInUseError);
  });

  it("keeps owner reads and appends on their own heads", async () => {
    const storage = await options.prepare();
    const main = thread({ id: "owner-heads", storage });
    await main.append({ id: "main", role: "user", content: "main" });
    const owner = createThreadHandle(
      { id: "owner-heads", storage },
      { id: "session-a", state: "open" },
    );
    await owner.append({ id: "owner", role: "user", content: "owner" });
    await owner.append({
      id: "owner-next",
      role: "assistant",
      content: "next",
    });

    await expect(main.read()).resolves.toMatchObject({
      head: "main",
      entries: [{ id: "main" }],
    });
    await expect(owner.read()).resolves.toMatchObject({
      head: "owner-next",
      entries: [{ id: "owner" }, { id: "owner-next" }],
    });
    expect(await storage.records.get("thread/owner-heads")).toMatchObject({
      owners: { "session-a": "open" },
      heads: { main: "main", "session-a": "owner-next" },
    });
  });
}
