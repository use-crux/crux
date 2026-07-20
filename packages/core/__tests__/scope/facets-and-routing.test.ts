import { describe, expect, it, vi } from "vitest";
import {
  ScopeSealedError,
  createScopeFacetSlot,
  openScope,
  resolveWritableScope,
  runScope,
  type ExecutionScope,
  type ScopeSealedWritePolicy,
} from "../../src/scope/internal";

describe("execution scope facets and write routing", () => {
  it("keeps writes on their open origin scope", () => {
    const controller = openScope({ kind: "invocation" }, {});
    expect(resolveWritableScope(controller.scope, {})).toBe(controller.scope);
  });

  it("resolves nearest facets and applies policy inheritance rules", async () => {
    const slot = createScopeFacetSlot<string>("test.scope-value");

    await runScope(
      { kind: "invocation" },
      {
        policies: {
          drain: "capture",
          sealedWrites: "throw",
          evidence: "diagnostics-only",
        },
      },
      async (root) => {
        root.setFacet(slot, "root");

        await runScope({ kind: "tool" }, {}, (child) => {
          expect(child.facet(slot)).toBe("root");
          expect(child.policies).toEqual({
            drain: "capture",
            sealedWrites: "throw",
            evidence: "public",
          });

          child.setFacet(slot, "child");
          expect(child.facet(slot)).toBe("child");
          expect(root.facet(slot)).toBe("root");
        });
      },
    );
  });

  it.each<ScopeSealedWritePolicy>(["drop", "reroute", "throw"])(
    "applies the %s policy to onClose and setFacet on a sealed root",
    (policy) => {
      const slot = createScopeFacetSlot<string>(`test.sealed-${policy}`);
      const controller = openScope(
        { kind: "invocation" },
        { policies: { sealedWrites: policy } },
      );
      const hook = vi.fn();
      controller.scope.setFacet(slot, "before");
      controller.seal("success");

      if (policy === "drop") {
        expect(() => controller.scope.onClose(hook)).not.toThrow();
        expect(() => controller.scope.setFacet(slot, "after")).not.toThrow();
        expect(hook).not.toHaveBeenCalled();
        expect(controller.scope.facet(slot)).toBe("before");
        return;
      }

      expect(() => controller.scope.onClose(hook)).toThrow(ScopeSealedError);
      expect(() => controller.scope.setFacet(slot, "after")).toThrow(
        ScopeSealedError,
      );
    },
  );

  it("reroutes sealed child writes to the nearest open ancestor", () => {
    const slot = createScopeFacetSlot<string>("test.rerouted");
    const root = openScope({ kind: "invocation" }, {});
    let child: ExecutionScope | undefined;
    const reroutedHook = vi.fn();

    root.run(() => {
      const controller = openScope({ kind: "tool" }, {});
      child = controller.scope;
      controller.seal("success");
    });

    expect(resolveWritableScope(child as ExecutionScope, {})).toBe(root.scope);
    child?.setFacet(slot, "on-root");
    child?.onClose(reroutedHook);
    expect(root.scope.facet(slot)).toBe("on-root");

    root.seal("success");
    expect(reroutedHook).toHaveBeenCalledOnce();
    expect(resolveWritableScope(child as ExecutionScope, {})).toBe("sealed");
  });

  it("accepts drain-phase writes while closing and invokes appended hooks in order", () => {
    const controller = openScope(
      { kind: "invocation" },
      { policies: { sealedWrites: "throw" } },
    );
    const calls: string[] = [];

    controller.scope.onClose(() => {
      calls.push("first");
      expect(resolveWritableScope(controller.scope, {})).toBe("sealed");
      expect(resolveWritableScope(controller.scope, { phase: "drain" })).toBe(
        controller.scope,
      );
      controller.scope.onClose(() => calls.push("nested"), { phase: "drain" });
    });

    controller.seal("success");

    expect(calls).toEqual(["first", "nested"]);
    expect(resolveWritableScope(controller.scope, { phase: "drain" })).toBe(
      "sealed",
    );
  });
});
