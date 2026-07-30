import { describe, expect, it } from "vitest";
import {
  inMemoryRecordStore,
  mutateRecord,
  storage,
  type JsonObject,
  type RecordStore,
} from "../src/storage";

interface CounterRecord extends JsonObject {
  readonly count: number;
}

describe("record mutation", () => {
  it("publishes, preserves, and deletes through one atomic mutation API", async () => {
    const records = inMemoryRecordStore<CounterRecord>();

    await expect(
      mutateRecord(records, "counter", (current) => ({
        type: "put",
        value: { count: (current?.count ?? 0) + 1 },
      })),
    ).resolves.toEqual({ count: 1 });
    await expect(
      mutateRecord(records, "counter", () => ({ type: "none" })),
    ).resolves.toEqual({ count: 1 });
    await expect(
      mutateRecord(records, "counter", () => ({ type: "delete" })),
    ).resolves.toBeNull();
    await expect(records.get("counter")).resolves.toBeNull();
  });

  it("preserves both concurrent mutations of one key", async () => {
    const records = inMemoryRecordStore<CounterRecord>();
    await records.put("counter", { count: 0 });

    await Promise.all([
      mutateRecord(records, "counter", async (current) => {
        await Promise.resolve();
        return {
          type: "put",
          value: { count: (current?.count ?? 0) + 1 },
        };
      }),
      mutateRecord(records, "counter", async (current) => {
        await Promise.resolve();
        return {
          type: "put",
          value: { count: (current?.count ?? 0) + 1 },
        };
      }),
    ]);

    await expect(records.get("counter")).resolves.toEqual({ count: 2 });
  });

  it("reports a conflict after bounded compare-and-set retries", async () => {
    const base = inMemoryRecordStore<CounterRecord>();
    const records: RecordStore<CounterRecord> = {
      ...base,
      mutate: undefined,
      getVersioned: async () => ({
        value: { count: 0 },
        version: "stale",
      }),
      putVersioned: async () => false,
      capabilities: () => ({
        ...base.capabilities(),
        mutate: "cas",
      }),
    };

    await expect(
      mutateRecord(
        records,
        "counter",
        (current) => ({
          type: "put",
          value: { count: (current?.count ?? 0) + 1 },
        }),
        { maxAttempts: 3, retryDelayMs: 0 },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("explains how to remedy unsupported atomic mutation", async () => {
    const base = inMemoryRecordStore<CounterRecord>();
    const records: RecordStore<CounterRecord> = {
      ...base,
      mutate: undefined,
      capabilities: () => ({
        ...base.capabilities(),
        mutate: false,
      }),
    };

    await expect(
      mutateRecord(records, "counter", () => ({ type: "none" })),
    ).rejects.toMatchObject({
      code: "unsupported_capability",
      message: expect.stringMatching(/native mutate.*getVersioned.*putVersioned/i),
    });
  });

  it("preserves atomic mutation through a scoped storage bundle", async () => {
    const base = inMemoryRecordStore<CounterRecord>();
    const records = storage.scope({ records: base }, "tenant").records;

    await expect(
      mutateRecord(records, "counter", () => ({
        type: "put",
        value: { count: 1 },
      })),
    ).resolves.toEqual({ count: 1 });
    await expect(base.get("tenant:counter")).resolves.toEqual({ count: 1 });
  });
});
