import { describe, expect, it } from "vitest";
import { withWorkspaceMutationLock } from "../../src/workspace/mutation-coordinator";

describe("workspace mutation coordinator", () => {
  it("does not serialize different namespaces", async () => {
    const firstEntered = deferred();
    const releaseFirst = deferred();
    const first = withWorkspaceMutationLock(
      "research",
      "thread:a",
      async () => {
        firstEntered.resolve();
        await releaseFirst.promise;
      },
    );
    await firstEntered.promise;

    const secondEntered = deferred();
    const second = withWorkspaceMutationLock(
      "research",
      "thread:b",
      async () => {
        secondEntered.resolve();
      },
    );
    await secondEntered.promise;

    expect(secondEntered.settled()).toBe(true);
    releaseFirst.resolve();
    await Promise.all([first, second]);
  });
});

function deferred(): {
  readonly promise: Promise<void>;
  resolve(): void;
  settled(): boolean;
} {
  let resolvePromise!: () => void;
  let isSettled = false;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      isSettled = true;
      resolvePromise();
    },
    settled: () => isSettled,
  };
}
