import { afterEach, describe, expect, it } from "vitest";
import { createAsyncScopeFacet } from "@use-crux/core/internal/async-scope";
import { setAsyncScopeResolverForTesting } from "../../src/async-scope/internal/carrier";

describe("async-scope facets", () => {
  afterEach(() => {
    setAsyncScopeResolverForTesting(undefined);
  });

  it("restores the nearest facet value after a nested scope exits", () => {
    const requestScope = createAsyncScopeFacet<{ readonly requestId: string }>(
      "test.request",
    );

    expect(requestScope.current()).toBeUndefined();

    requestScope.run({ requestId: "outer" }, () => {
      expect(requestScope.current()).toEqual({ requestId: "outer" });

      requestScope.run({ requestId: "inner" }, () => {
        expect(requestScope.current()).toEqual({ requestId: "inner" });
      });

      expect(requestScope.current()).toEqual({ requestId: "outer" });
    });

    expect(requestScope.current()).toBeUndefined();
  });

  it("keeps independent facets active without overwriting each other", () => {
    const executionScope = createAsyncScopeFacet<string>("test.execution");
    const runtimeScope = createAsyncScopeFacet<number>("test.runtime");

    executionScope.run("request-1", () => {
      runtimeScope.run(42, () => {
        expect(executionScope.current()).toBe("request-1");
        expect(runtimeScope.current()).toBe(42);
      });
    });
  });

  it("isolates concurrent facet values across awaits", async () => {
    const requestScope = createAsyncScopeFacet<string>(
      "test.concurrent-request",
    );
    let releaseFirst: (() => void) | undefined;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = requestScope.run("first", async () => {
      await firstPaused;
      return requestScope.current();
    });
    const second = requestScope.run("second", async () => {
      await Promise.resolve();
      return requestScope.current();
    });

    expect(await second).toBe("second");
    releaseFirst?.();
    expect(await first).toBe("first");
  });

  it("limits fallback propagation to the synchronous callback frame", async () => {
    setAsyncScopeResolverForTesting(() => undefined);
    const requestScope = createAsyncScopeFacet<string>("test.no-als");
    let synchronousValue: string | undefined;
    let asynchronousValue: string | undefined;

    await requestScope.run("request-1", async () => {
      synchronousValue = requestScope.current();
      await Promise.resolve();
      asynchronousValue = requestScope.current();
    });

    expect(synchronousValue).toBe("request-1");
    expect(asynchronousValue).toBeUndefined();
    expect(requestScope.current()).toBeUndefined();
  });

  it("resolves a host-provided global AsyncLocalStorage once before Node", () => {
    const runtime = globalThis as typeof globalThis & {
      AsyncLocalStorage?: typeof FakeAsyncLocalStorage;
    };
    const original = Object.getOwnPropertyDescriptor(
      runtime,
      "AsyncLocalStorage",
    );
    let constructions = 0;

    class FakeAsyncLocalStorage<T> {
      private store: T | undefined;

      constructor() {
        constructions += 1;
      }

      run<R>(store: T, callback: () => R): R {
        const previous = this.store;
        this.store = store;
        try {
          return callback();
        } finally {
          this.store = previous;
        }
      }

      getStore(): T | undefined {
        return this.store;
      }
    }

    try {
      Object.defineProperty(runtime, "AsyncLocalStorage", {
        configurable: true,
        value: FakeAsyncLocalStorage,
      });
      setAsyncScopeResolverForTesting(undefined);
      const first = createAsyncScopeFacet<string>("test.global-first");

      expect(first.run("active", () => first.current())).toBe("active");
      expect(constructions).toBe(1);

      const second = createAsyncScopeFacet<string>("test.global-second");
      expect(second.run("still-active", () => second.current())).toBe(
        "still-active",
      );
      expect(constructions).toBe(1);
    } finally {
      if (original) {
        Object.defineProperty(runtime, "AsyncLocalStorage", original);
      } else {
        Reflect.deleteProperty(runtime, "AsyncLocalStorage");
      }
      setAsyncScopeResolverForTesting(undefined);
    }
  });
});
