import { afterEach, describe, expect, it } from "vitest";
import {
  captureAsyncScope,
  runWithCapturedAsyncScope,
  setAsyncScopeResolverForTesting,
  type CapturedAsyncScope,
} from "../../src/async-scope/internal/carrier";
import {
  createScopeFacetSlot,
  currentScope,
  currentScopeFacet,
  openScope,
  runScope,
  runWithScopeFacet,
} from "../../src/scope/internal";

describe("execution-local scope facet overrides", () => {
  afterEach(() => {
    setAsyncScopeResolverForTesting(undefined);
  });

  it("shadows persistent facets without mutating the scope or its ancestors", async () => {
    const slot = createScopeFacetSlot<string>("test.override-shadowing");

    await runScope({ kind: "invocation" }, {}, async (root) => {
      root.setFacet(slot, "root");
      await runScope({ kind: "tool" }, {}, (child) => {
        child.setFacet(slot, "child");

        expect(currentScopeFacet(slot)).toBe("child");
        runWithScopeFacet(slot, "override", () => {
          expect(currentScope()).toBe(child);
          expect(currentScopeFacet(slot)).toBe("override");
          expect(child.facet(slot)).toBe("child");
          expect(root.facet(slot)).toBe("root");
        });
        expect(currentScopeFacet(slot)).toBe("child");
      });
    });
  });

  it("propagates an override across awaits", async () => {
    const slot = createScopeFacetSlot<string>("test.override-await");

    await runScope({ kind: "invocation" }, {}, async () => {
      await runWithScopeFacet(slot, "async", async () => {
        await Promise.resolve();
        expect(currentScopeFacet(slot)).toBe("async");
      });
    });
  });

  it("isolates concurrent execution branches", async () => {
    const slot = createScopeFacetSlot<string>("test.override-concurrency");
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await runScope({ kind: "invocation" }, {}, async () => {
      const first = runWithScopeFacet(slot, "first", async () => {
        await gate;
        return currentScopeFacet(slot);
      });
      const second = runWithScopeFacet(slot, "second", async () => {
        await Promise.resolve();
        return currentScopeFacet(slot);
      });

      expect(await second).toBe("second");
      release?.();
      expect(await first).toBe("first");
    });
  });

  it("restores the outer value after a nested override", async () => {
    const slot = createScopeFacetSlot<string>("test.override-nested");

    await runScope({ kind: "invocation" }, {}, () =>
      runWithScopeFacet(slot, "outer", () => {
        expect(currentScopeFacet(slot)).toBe("outer");
        runWithScopeFacet(slot, "inner", () => {
          expect(currentScopeFacet(slot)).toBe("inner");
        });
        expect(currentScopeFacet(slot)).toBe("outer");
      }),
    );
  });

  it("includes overrides in captured and restored carrier frames", () => {
    const slot = createScopeFacetSlot<string>("test.override-captured");
    const controller = openScope({ kind: "adapter-call" }, {});
    let captured: CapturedAsyncScope | undefined;

    controller.run(() => {
      runWithScopeFacet(slot, "captured", () => {
        captured = captureAsyncScope();
      });
    });

    runWithCapturedAsyncScope(captured as CapturedAsyncScope, () => {
      expect(currentScope()).toBe(controller.scope);
      expect(currentScopeFacet(slot)).toBe("captured");
    });
    controller.seal("success");
  });

  it("limits fallback overrides to the synchronous callback frame without ALS", async () => {
    setAsyncScopeResolverForTesting(() => undefined);
    const slot = createScopeFacetSlot<string>("test.override-no-als");
    let afterAwait: string | undefined;

    await runScope({ kind: "invocation" }, {}, async () => {
      await runWithScopeFacet(slot, "synchronous", async () => {
        expect(currentScopeFacet(slot)).toBe("synchronous");
        await Promise.resolve();
        afterAwait = currentScopeFacet(slot);
      });
    });

    expect(afterAwait).toBeUndefined();
  });
});
