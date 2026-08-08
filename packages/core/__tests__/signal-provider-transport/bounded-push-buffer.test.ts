/**
 * Bounded push buffer: capacity, overflow, abort, clean close.
 */

import { describe, expect, it } from "vitest";

import {
  createBoundedPushBuffer,
  TRANSPORT_PUSH_BUFFER_OVERFLOW,
} from "../../src/signal/transport/bounded-push-buffer";

describe("createBoundedPushBuffer", () => {
  it("requires a positive integer capacity", () => {
    expect(() => createBoundedPushBuffer({ capacity: 0 })).toThrow(TypeError);
    expect(() => createBoundedPushBuffer({ capacity: -1 })).toThrow(TypeError);
    expect(() => createBoundedPushBuffer({ capacity: 1.5 })).toThrow(TypeError);
  });

  it("delivers pushed items under pull without dropping", async () => {
    const buffer = createBoundedPushBuffer<number>({ capacity: 2 });
    buffer.push(1);
    buffer.push(2);
    buffer.close();

    const items: number[] = [];
    for await (const item of buffer.items) {
      items.push(item);
    }
    expect(items).toEqual([1, 2]);
  });

  it("fails on overflow instead of dropping", async () => {
    const buffer = createBoundedPushBuffer<number>({ capacity: 1 });
    buffer.push(1);
    expect(() => buffer.push(2)).toThrow(/TRANSPORT_PUSH_BUFFER_OVERFLOW/);
    expect(buffer.closed).toBe(true);

    const iterator = buffer.items[Symbol.asyncIterator]();
    // Already-buffered item is still available; overflow never dropped it.
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(iterator.next()).rejects.toMatchObject({
      code: TRANSPORT_PUSH_BUFFER_OVERFLOW,
    });
  });

  it("wakes a waiting consumer on push", async () => {
    const buffer = createBoundedPushBuffer<string>({ capacity: 4 });
    const iteration = (async () => {
      const items: string[] = [];
      for await (const item of buffer.items) {
        items.push(item);
        if (items.length === 1) {
          buffer.close();
        }
      }
      return items;
    })();

    await Promise.resolve();
    buffer.push("hello");
    await expect(iteration).resolves.toEqual(["hello"]);
  });

  it("rejects waiters when the open signal aborts", async () => {
    const controller = new AbortController();
    const buffer = createBoundedPushBuffer<number>({
      capacity: 2,
      signal: controller.signal,
    });

    const pending = (async () => {
      for await (const _ of buffer.items) {
        // wait
      }
    })();

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fail(undefined) rejects an already-waiting pull", async () => {
    const buffer = createBoundedPushBuffer<number>({ capacity: 2 });
    const iterator = buffer.items[Symbol.asyncIterator]();
    const pending = iterator.next();

    await Promise.resolve();
    buffer.fail(undefined);

    await expect(pending).rejects.toBeUndefined();
  });

  it("fail(undefined) rejects subsequent pulls after the queue drains", async () => {
    const buffer = createBoundedPushBuffer<number>({ capacity: 2 });
    buffer.push(1);
    buffer.fail(undefined);

    const iterator = buffer.items[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: false, value: 1 });
    await expect(iterator.next()).rejects.toBeUndefined();
  });

  it("push after fail(undefined) reports failure rather than clean closure", () => {
    const buffer = createBoundedPushBuffer<number>({ capacity: 2 });
    buffer.fail(undefined);

    expect(buffer.closed).toBe(true);
    expect(() => buffer.push(1)).toThrow();
    expect(() => buffer.push(1)).not.toThrow(/is closed/);
  });
});
