import { afterEach, describe, expect, it } from "vitest";
import { getSession, prompt, resetHooks, session } from "@use-crux/core";
import { agent } from "@use-crux/core/agent";
import { inMemoryRuntimeStore } from "@use-crux/core/runtime";
import { inMemoryRecordStore } from "@use-crux/core/storage";
import { z } from "zod";
import { sessionHost } from "./public-session.test-support";

afterEach(() => resetHooks());

describe("public Agent Session lifecycle", () => {
  it("rejects a different target without registering another Thread owner", async () => {
    const first = agent({
      id: "conflict-first",
      prompt: prompt({
        input: z.object({ value: z.string() }),
        system: "First.",
      }),
    });
    const second = agent({
      id: "conflict-second",
      prompt: prompt({
        input: z.object({ value: z.string() }),
        system: "Second.",
      }),
    });
    const { host, records } = sessionHost("conflict-session-test");
    const created = await host.run(() => session(first, { key: "shared" }));

    await expect(
      host.run(() => session(second, { key: "shared" })),
    ).rejects.toMatchObject({ code: "SESSION_IDENTITY_CONFLICT" });
    await expect(
      host.run(() => getSession(second, "shared")),
    ).rejects.toMatchObject({ code: "SESSION_IDENTITY_CONFLICT" });
    const control = await records.get(`thread/${created.thread.id}`);
    expect(control?.owners).toEqual({ [created.id]: "open" });
    host.dispose();
  });

  it("repairs a compatible prepared Session after restart", async () => {
    const records = inMemoryRecordStore();
    const support = agent({
      id: "repair-session-support",
      prompt: prompt({
        input: z.object({ value: z.string() }),
        system: "Repair.",
      }),
    });
    const store = inMemoryRuntimeStore();
    let transactions = 0;
    const interruptedStore = {
      ...store,
      async transact<T>(
        run: Parameters<typeof store.transact<T>>[0],
      ): Promise<T> {
        transactions += 1;
        if (transactions === 2) throw new Error("restart before ready");
        return store.transact(run);
      },
    };
    const interrupted = sessionHost(
      "repair-session-test",
      interruptedStore,
      records,
    ).host;
    await expect(
      interrupted.run(() => session(support, { key: "repair" })),
    ).rejects.toThrow("restart before ready");
    interrupted.dispose();

    const { host } = sessionHost("repair-session-test", store, records);
    const repaired = await host.run(() => session(support, { key: "repair" }));
    expect(
      store.testing.sessionRecord("repair-session-test", repaired.id),
    ).toMatchObject({
      state: "ready",
    });
    const control = await records.get(`thread/${repaired.thread.id}`);
    expect(control?.owners).toEqual({ [repaired.id]: "open" });
    host.dispose();
  });

  it("does not create a missing Session during retrieval", async () => {
    const support = agent({
      id: "missing-session-support",
      prompt: prompt({
        id: "missing-session-support-prompt",
        input: z.object({ message: z.string() }),
        system: "Reply helpfully.",
      }),
    });
    const { host, store } = sessionHost("missing-session-test");

    await expect(
      host.run(() => getSession(support, "customer:missing")),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
    expect(store.testing.sessionRecords("missing-session-test")).toEqual([]);
    host.dispose();
  });

  it("creates or reopens one inert keyed owner and accepts ordered input", async () => {
    let executions = 0;
    const support = agent({
      id: "public-session-support",
      prompt: prompt({
        id: "public-session-support-prompt",
        input: z.object({ message: z.string() }),
        output: z.object({ reply: z.string() }),
        system: () => {
          executions += 1;
          return "Reply helpfully.";
        },
      }),
    });
    const { host, records, store } = sessionHost("public-session-test");

    const created = await host.run(() =>
      session(support, { key: "customer:42" }),
    );
    const reopened = await host.run(() => getSession(support, "customer:42"));

    expect(reopened.id).toBe(created.id);
    expect(Object.isFrozen(created)).toBe(true);
    expect(Object.isFrozen(created.thread)).toBe(true);
    expect(await created.thread.read()).toEqual({
      entries: [],
      revision: expect.any(String),
      threadId: created.thread.id,
    });
    const control = await records.get(`thread/${created.thread.id}`);
    expect(control?.owners).toEqual({ [created.id]: "open" });

    const accepted = await created.sendMany([
      { message: "First" },
      { message: "Second" },
    ]);

    expect(accepted.map(({ cursor }) => cursor)).toEqual(["1", "2"]);
    expect(accepted.every(Object.isFrozen)).toBe(true);
    expect(
      store.testing.sessionRecord("public-session-test", created.id),
    ).toMatchObject({
      acceptedCursor: 2,
      wakePending: true,
    });
    expect(
      await store.outbox.list({ namespace: "public-session-test", limit: 10 }),
    ).toEqual([]);
    expect(executions).toBe(0);
    expect(await created.thread.read()).toMatchObject({ entries: [] });
    host.dispose();
  });
});
