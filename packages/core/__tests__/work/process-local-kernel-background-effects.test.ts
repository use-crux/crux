import { expect, it } from "vitest";
import { runPassiveEffectBoundary } from "../../src/effect/internal/boundary";
import { createInternalWorkOwnerPort } from "../../src/work/internal/owner-retained-work";
import {
  createProcessLocalWorkKernel,
  type InternalWorkHandle,
} from "../../src/work/internal/process-local-kernel";

it("lets an independently effect-parented child outlive its parent boundary", async () => {
  let releaseChild!: () => void;
  const childGate = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  let childStarted!: () => void;
  const childStartedGate = new Promise<void>((resolve) => {
    childStarted = resolve;
  });
  const output = Object.freeze({ kind: "finished" as const, count: 1 });
  const owner = createInternalWorkOwnerPort(createProcessLocalWorkKernel());
  let retained!: InternalWorkHandle<typeof output>;

  let parentSettled = false;
  const parent = runPassiveEffectBoundary("parent", async () => {
    const reference = await owner.spawnAndRetain(
      {
        async run() {
          childStarted();
          await childGate;
          return output;
        },
      },
      { kind: "cancellation-only", effectParent: "independent" },
    );
    const handle = owner.recover(reference);
    if (!handle) throw new Error("Retained Work handle is unavailable.");
    retained = handle;
  });
  void parent.then(() => {
    parentSettled = true;
  });

  await childStartedGate;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(parentSettled).toBe(true);

  releaseChild();
  await expect(parent).resolves.toBeUndefined();
  await expect(retained.result()).resolves.toEqual(output);
});
