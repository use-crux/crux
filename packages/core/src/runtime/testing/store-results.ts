import { expect, it } from "vitest";
import type { RuntimeStoreAdapter } from "../store";
import type { RunStoreAdapterTestsOptions } from "./store-types";
import { makeConformanceWorkItem } from "./store-fixtures";

/** Register shared content-addressed result storage checks when supported. */
export function registerStoreResultTests<TStore extends RuntimeStoreAdapter>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  it("invariant: result payloads are canonical, integrity-checked, and deletable", async () => {
    const store = await options.createStore();
    if (!store.results) return;

    const first = await store.results.put(
      { b: 2, a: 1 },
      { namespace: "tenant-a" },
    );
    const duplicate = await store.results.put(
      { a: 1, b: 2 },
      { namespace: "tenant-a" },
    );
    expect(duplicate).toEqual(first);
    await expect(store.results.get(first)).resolves.toEqual({ a: 1, b: 2 });
    await expect(
      store.results.get({ ...first, size: first.size + 1 }),
    ).rejects.toThrow();

    await store.state.putWork(
      makeConformanceWorkItem({ status: "completed", resultRef: first }),
    );
    const completed = await store.state.getWork(
      makeConformanceWorkItem().workId,
      { namespace: "tenant-a" },
    );
    expect(completed?.resultRef).toEqual(first);
    expect(Object.isFrozen(completed?.resultRef)).toBe(true);

    await store.state.putWork(makeConformanceWorkItem({ status: "completed" }));
    await store.results.delete(first);
    await expect(store.results.get(first)).resolves.toBeNull();
  });
}
