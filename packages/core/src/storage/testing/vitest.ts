/**
 * Vitest conformance helpers for Storage Beta adapters.
 *
 * Adapter packages can use these suites to prove their claimed
 * `RecordStore`, `VectorStore`, and `AssetStore` capabilities through the
 * public storage interfaces.
 *
 * @module
 */

import { describe, expect, it, vi } from "vitest";
import { StorageError } from "../errors";
import type { JsonObject, RecordEntry, RecordStore } from "../types";

export { vectorStoreConformanceSuite } from "./vector";
export type {
  VectorStoreConformanceCapabilities,
  VectorStoreConformanceHarness,
  VectorStoreConformanceSuiteOptions,
} from "./vector";
export {
  describeVectorStoreConformance,
  type DescribeVectorStoreConformanceOptions,
} from "./vector-conformance";
export {
  describeAssetStoreConformance,
  type DescribeAssetStoreConformanceOptions,
} from "./asset-conformance";

/** Options for {@link describeRecordStoreConformance}. */
export interface DescribeRecordStoreConformanceOptions<
  T extends JsonObject = JsonObject,
> {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string;
  /** Create a fresh, isolated record store for each conformance test. */
  readonly prepare: () => RecordStore<T> | Promise<RecordStore<T>>;
}

/** Register shared behavior checks for beta `RecordStore` adapters. */
export function describeRecordStoreConformance<
  T extends JsonObject = JsonObject,
>(options: DescribeRecordStoreConformanceOptions<T>): void {
  describe(`${options.name} RecordStore conformance`, () => {
    it("round-trips, creates atomically, deletes, and isolates JSON records", async () => {
      const records = await options.prepare();
      const original = { title: "hello", nested: { count: 1 } } as unknown as T;

      await expect(records.get("records:missing")).resolves.toBeNull();
      await records.put("records:item", original);
      (original as unknown as { title: string }).title = "mutated";

      const firstRead = await records.get("records:item");
      expect(firstRead).toEqual({ title: "hello", nested: { count: 1 } });
      if (firstRead) {
        (firstRead as unknown as { nested: { count: number } }).nested.count =
          2;
      }
      await expect(records.get("records:item")).resolves.toEqual({
        title: "hello",
        nested: { count: 1 },
      });

      await expect(
        records.create("records:item", { title: "ignored" } as unknown as T),
      ).resolves.toBe(false);
      await expect(
        records.create("records:new", { title: "new" } as unknown as T),
      ).resolves.toBe(true);
      await expect(records.get("records:new")).resolves.toEqual({
        title: "new",
      });

      await records.delete("records:item");
      await expect(records.get("records:item")).resolves.toBeNull();
    });

    it("rejects invalid JSON values and invalid TTL values with storage errors", async () => {
      const records = await options.prepare();

      await expect(
        records.put("invalid:date", { createdAt: new Date() } as unknown as T),
      ).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(
        records.put("invalid:ttl", { ok: true } as unknown as T, { ttlMs: 0 }),
      ).rejects.toMatchObject({
        code: "invalid_value",
      });
      await expect(
        records.put("invalid:ttl", { ok: true } as unknown as T, {
          ttlMs: 1.5,
        }),
      ).rejects.toMatchObject({
        code: "invalid_value",
      });
    });

    it("lists, scans, filters, and distinguishes null from missing fields", async () => {
      const records = await options.prepare();
      await records.put("memory:a", {
        kind: "note",
        removedAt: null,
        updatedAt: 100,
      } as unknown as T);
      await records.put("memory:b", {
        kind: "task",
        updatedAt: 200,
      } as unknown as T);
      await records.put("memory:c", {
        kind: "note",
        removedAt: null,
        updatedAt: 300,
      } as unknown as T);
      await records.put("other:a", {
        kind: "note",
        removedAt: null,
        updatedAt: 400,
      } as unknown as T);

      const firstPage = await records.list("memory:", { limit: 2 });
      expect(firstPage.entries).toHaveLength(2);
      expect(firstPage.cursor).toBeDefined();
      const secondPage = await records.list("memory:", {
        limit: 2,
        cursor: firstPage.cursor,
      });
      expectKeys(
        [...firstPage.entries, ...secondPage.entries],
        ["memory:a", "memory:b", "memory:c"],
      );

      expectKeys(
        (await records.list("memory:", { filter: { kind: "note" } })).entries,
        ["memory:a", "memory:c"],
      );
      expectKeys(
        (await records.list("memory:", { filter: { removedAt: null } }))
          .entries,
        ["memory:a", "memory:c"],
      );

      if (records.scan) {
        const scanned: RecordEntry<T>[] = [];
        for await (const entry of records.scan("memory:", { limit: 1 })) {
          scanned.push(entry);
        }
        expectKeys(scanned, ["memory:a", "memory:b", "memory:c"]);
      }
    });

    it("suppresses lazy-TTL records from get, list, and scan", async () => {
      const records = await options.prepare();
      if (records.capabilities().ttl === false) {
        await expect(
          records.put("ttl:nope", { ok: true } as unknown as T, { ttlMs: 100 }),
        ).rejects.toBeInstanceOf(StorageError);
        return;
      }

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-06-30T00:00:00.000Z"));
        await records.put("ttl:expired", { status: "old" } as unknown as T, {
          ttlMs: 1_000,
        });
        await records.put("ttl:fresh", { status: "fresh" } as unknown as T);
        vi.advanceTimersByTime(1_001);

        await expect(records.get("ttl:expired")).resolves.toBeNull();
        expectKeys((await records.list("ttl:")).entries, ["ttl:fresh"]);
        if (records.scan) {
          const scanned: RecordEntry<T>[] = [];
          for await (const entry of records.scan("ttl:")) {
            scanned.push(entry);
          }
          expectKeys(scanned, ["ttl:fresh"]);
        }
      } finally {
        vi.useRealTimers();
      }
    });
  });
}

function expectKeys(
  entries: readonly { readonly key: string }[],
  expectedKeys: readonly string[],
): void {
  expect(new Set(entries.map((entry) => entry.key))).toEqual(
    new Set(expectedKeys),
  );
}
