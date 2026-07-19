import { describe, expect, it, vi } from "vitest";
import { createParallel, type AgentExecutor } from "../../src/agent";
import { defer } from "../../src/defer";
import { withServerlessDefer } from "../../src/defer/serverless";
import { config } from "../../src/runtime/config";
import { currentScope, type ExecutionScope } from "../../src/scope/internal";
import type { CruxHostBinding } from "../../src/scope/types";

const unusedExecutor: AgentExecutor = async () => {
  throw new Error("Plain function members do not call the agent executor.");
};

describe("primitive-root host retention", () => {
  it("starts a primitive drain immediately and retains it to root idle", async () => {
    const drainStarted = deferred<void>();
    const releaseDrain = deferred<void>();
    let retainedWork: (() => Promise<void>) | undefined;
    const retain = vi.fn((work: () => Promise<void>) => {
      retainedWork = work;
    });
    const binding: CruxHostBinding = {
      kind: "freezing-test",
      invocationScope: true,
      retain,
    };
    const crux = config({ host: binding });

    try {
      const parallel = createParallel(unusedExecutor);
      await parallel({
        id: "retained-agent-root",
        context: {},
        agents: {
          researcher: async () => {
            defer(async () => {
              drainStarted.resolve();
              await releaseDrain.promise;
            });
            return "done";
          },
        },
      });

      await drainStarted.promise;
      expect(retain).toHaveBeenCalledOnce();

      let retainedSettled = false;
      const retained = runRetainedWork(retainedWork).then(() => {
        retainedSettled = true;
      });
      await Promise.resolve();
      expect(retainedSettled).toBe(false);

      releaseDrain.resolve();
      await retained;
      expect(retainedSettled).toBe(true);
    } finally {
      releaseDrain.resolve();
      crux.dispose();
    }
  });

  it("rejects inline work when the configured host is named-only", async () => {
    const crux = config({
      host: {
        kind: "named-only-test",
        invocationScope: false,
        supportsInline: false,
        retain: vi.fn(),
      },
    });

    try {
      const parallel = createParallel(unusedExecutor);
      await expect(
        parallel({
          id: "named-only-agent-root",
          context: {},
          agents: {
            researcher: async () => {
              defer(() => {});
              return "unreachable";
            },
          },
        }),
      ).rejects.toMatchObject({ code: "DEFER_CAPABILITY_MISSING" });
    } finally {
      crux.dispose();
    }
  });

  it("enforces configured host callback limits inside a primitive", async () => {
    const crux = config({
      host: {
        kind: "bounded-test",
        invocationScope: false,
        retain: vi.fn(),
        limits: {
          maxDrainMs: 30_000,
          maxCallbacks: 1,
          concurrency: 1,
          maxNestingDepth: 1,
        },
      },
    });

    try {
      const parallel = createParallel(unusedExecutor);
      await expect(
        parallel({
          id: "bounded-agent-root",
          context: {},
          agents: {
            researcher: async () => {
              defer(() => {});
              defer(() => {});
              return "unreachable";
            },
          },
        }),
      ).rejects.toMatchObject({ code: "DEFER_LIMIT_EXCEEDED" });
    } finally {
      crux.dispose();
    }
  });

  it("does not attach configured retention beneath a wrapper root", async () => {
    const configuredRetain = vi.fn();
    const wrapperRetain = vi.fn();
    const crux = config({
      host: {
        kind: "configured-test",
        invocationScope: true,
        retain: configuredRetain,
      },
    });

    try {
      const parallel = createParallel(unusedExecutor);
      const handler = withServerlessDefer(
        () =>
          parallel({
            id: "wrapped-agent-root",
            context: {},
            agents: {
              researcher: async () => {
                defer(() => {});
                return "done";
              },
            },
          }),
        {
          binding: {
            kind: "wrapper-test",
            invocationScope: false,
            retain: wrapperRetain,
          },
        },
      );

      await handler();

      expect(wrapperRetain).toHaveBeenCalledOnce();
      expect(configuredRetain).not.toHaveBeenCalled();
    } finally {
      crux.dispose();
    }
  });

  it("surfaces a configured retention failure from a primitive root", async () => {
    const retentionError = new Error("retention unavailable");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    let observedScope: ExecutionScope | undefined;
    const crux = config({
      host: {
        kind: "unavailable-test",
        invocationScope: true,
        retain() {
          throw retentionError;
        },
      },
    });

    try {
      const parallel = createParallel(unusedExecutor);
      await expect(
        parallel({
          id: "unretained-agent-root",
          context: {},
          agents: {
            researcher: async () => {
              observedScope = currentScope();
              defer(() => {});
              return "unreachable";
            },
          },
        }),
      ).rejects.toBe(retentionError);
      expect(observedScope?.state).toBe("sealed");
      expect(observedScope?.sealedReason).toBe("closed");
    } finally {
      crux.dispose();
      consoleError.mockRestore();
    }
  });

  it("contains user close-hook failures when retention also fails", async () => {
    const retentionError = new Error("retention unavailable");
    const hookError = new Error("user close hook failed");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const crux = config({
      host: {
        kind: "unavailable-test",
        invocationScope: true,
        retain() {
          throw retentionError;
        },
      },
    });

    try {
      const parallel = createParallel(unusedExecutor);
      await expect(
        parallel({
          id: "contained-hook-agent-root",
          context: {},
          agents: {
            researcher: async () => {
              defer(() => {});
              const scope = currentScope();
              if (!scope) throw new TypeError("Expected an agent-turn scope.");
              scope.onClose(() => {
                throw hookError;
              });
              return "unreachable";
            },
          },
        }),
      ).rejects.toBe(retentionError);

      expect(consoleError).toHaveBeenCalledWith(
        "Crux execution scope close hook failed.",
        hookError,
      );
    } finally {
      crux.dispose();
      consoleError.mockRestore();
    }
  });

  it("surfaces retention failure synchronously from ambient defer", () => {
    const retentionError = new Error("ambient retention unavailable");
    const crux = config({
      host: {
        kind: "ambient-unavailable-test",
        invocationScope: true,
        retain() {
          throw retentionError;
        },
      },
    });

    try {
      expect(() => defer(() => {})).toThrow(retentionError);
    } finally {
      crux.dispose();
    }
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return Object.freeze({ promise, resolve });
}

function runRetainedWork(
  work: (() => Promise<void>) | undefined,
): Promise<void> {
  if (!work) throw new TypeError("No retained work was registered.");
  return work();
}
