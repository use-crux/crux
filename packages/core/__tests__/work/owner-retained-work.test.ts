import { describe, expect, it } from "vitest";
import { createInternalWorkOwnerPort } from "../../src/work/internal/owner-retained-work";
import { createProcessLocalWorkKernel } from "../../src/work/internal/process-local-kernel";

describe("owner-retained process-local Work", () => {
  it("keeps a nonterminal child in its originating owner's content-free inbox", async () => {
    let finishChild!: (result: { readonly secret: "retained" }) => void;
    const childResult = new Promise<{ readonly secret: "retained" }>((resolve) => {
      finishChild = resolve;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_owner_inbox_child",
      schedule: (start) => start(),
    });
    const originatingOwner = createInternalWorkOwnerPort(kernel);
    const otherOwner = createInternalWorkOwnerPort(kernel);

    const retained = await originatingOwner.spawnAndRetain({
      run: () => childResult,
    });

    const inbox = originatingOwner.list();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toEqual({ id: "work_owner_inbox_child" });
    expect(Object.isFrozen(inbox[0])).toBe(true);
    expect(Object.keys(inbox[0] ?? {})).toEqual(["id"]);
    expect(otherOwner.list()).toEqual([]);

    const retainedHandle = originatingOwner.lookup(retained.id);
    expect(retainedHandle).toBeDefined();
    expect(otherOwner.lookup(retained.id)).toBeUndefined();
    finishChild({ secret: "retained" });
    await expect(retainedHandle?.result()).resolves.toEqual({ secret: "retained" });
  });

  it("lets only the originating owner recover an accepted typed child without leaking its result", async () => {
    let finishChild!: (result: { readonly answer: 42 }) => void;
    const childResult = new Promise<{ readonly answer: 42 }>((resolve) => {
      finishChild = resolve;
    });
    const kernel = createProcessLocalWorkKernel({
      createId: () => "work_retained_child",
      schedule: (start) => start(),
    });
    const originatingOwner = createInternalWorkOwnerPort(kernel);
    const otherOwner = createInternalWorkOwnerPort(kernel);

    const retained = await originatingOwner.spawnAndRetain({
      run: () => childResult,
    });

    expect(retained).toEqual({ id: "work_retained_child" });
    expect(otherOwner.recover(retained)).toBeUndefined();

    const recovered = originatingOwner.recover(retained);
    expect(recovered).toBeDefined();
    finishChild({ answer: 42 });
    await expect(recovered?.result()).resolves.toEqual({ answer: 42 });
  });
});
