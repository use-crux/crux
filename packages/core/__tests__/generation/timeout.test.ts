import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Deadline,
  TimeoutError,
  toolBudgetMs,
  withBudget,
} from "../../src/generation/timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("generation timeout budgets", () => {
  it("distinguishes a named Tool clear from an absent override", () => {
    const cases = [
      {
        label: "named null clears the inherited default",
        timeout: { toolMs: 5_000, tools: { search: null } },
        expected: undefined,
      },
      {
        label: "an absent name inherits the default",
        timeout: { toolMs: 5_000, tools: {} },
        expected: 5_000,
      },
      {
        label: "a null default is disabled",
        timeout: { toolMs: null },
        expected: undefined,
      },
      {
        label: "zero is disabled",
        timeout: { toolMs: 0 },
        expected: undefined,
      },
      {
        label: "negative values are disabled",
        timeout: { toolMs: -1 },
        expected: undefined,
      },
      {
        label: "NaN is disabled",
        timeout: { toolMs: Number.NaN },
        expected: undefined,
      },
      {
        label: "positive infinity is disabled",
        timeout: { toolMs: Number.POSITIVE_INFINITY },
        expected: undefined,
      },
      {
        label: "negative infinity is disabled",
        timeout: { toolMs: Number.NEGATIVE_INFINITY },
        expected: undefined,
      },
    ] as const;

    for (const { label, timeout, expected } of cases) {
      expect(toolBudgetMs(timeout, "search"), label).toBe(expected);
    }
  });

  it("rejects with a typed TimeoutError carrying budget metadata", async () => {
    vi.useFakeTimers();

    const result = withBudget(
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("late"), 1_000),
        ),
      { budget: "step", limitMs: 50 },
    );

    const assertion = expect(result).rejects.toMatchObject({
      name: "TimeoutError",
      budget: "step",
      limitMs: 50,
    });
    const instanceAssertion =
      expect(result).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    await instanceAssertion;
  });

  it("recognizes canonical timeout errors across package copies", () => {
    const marker = Symbol.for("@use-crux/core/TimeoutError");
    const local = new TimeoutError({ budget: "step", limitMs: 50 });

    class ForeignTimeoutError extends Error {
      override readonly name = "TimeoutError";
      readonly budget = "step";
      readonly limitMs = 50;

      constructor() {
        super("step timeout exceeded 50ms");
        Object.defineProperty(this, marker, { value: true });
      }
    }

    const renamed = new Error("not canonical");
    renamed.name = "TimeoutError";

    expect(TimeoutError.isInstance(local)).toBe(true);
    expect(TimeoutError.isInstance(new ForeignTimeoutError())).toBe(true);
    expect(TimeoutError.isInstance(new Error("ordinary"))).toBe(false);
    expect(TimeoutError.isInstance({ name: "TimeoutError" })).toBe(false);
    expect(TimeoutError.isInstance(renamed)).toBe(false);
    expect(Object.getOwnPropertyDescriptor(local, marker)).toMatchObject({
      enumerable: false,
      value: true,
    });
  });

  it("includes the tool name when a per-tool budget expires", async () => {
    vi.useFakeTimers();

    const result = withBudget(
      () =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("late"), 1_000),
        ),
      { budget: "tool", limitMs: 25, toolName: "search" },
    );

    const assertion = expect(result).rejects.toMatchObject({
      budget: "tool",
      limitMs: 25,
      toolName: "search",
    });

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
  });
});

describe("Deadline", () => {
  it("aborts when its total budget expires", async () => {
    vi.useFakeTimers();

    const deadline = Deadline.after(50);
    const aborted = new Promise<unknown>((resolve) =>
      deadline.signal.addEventListener(
        "abort",
        () => resolve(deadline.signal.reason),
        { once: true },
      ),
    );

    await vi.advanceTimersByTimeAsync(50);

    await expect(aborted).resolves.toMatchObject({
      name: "TimeoutError",
      budget: "total",
      limitMs: 50,
    });
    expect(deadline.signal.aborted).toBe(true);

    deadline.dispose();
  });

  it("keeps disabled deadlines open and reports no finite remaining budget", () => {
    const deadline = Deadline.after(undefined);

    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remaining()).toBeUndefined();

    deadline.dispose();
  });

  it("composes parent and attempt signals so the earlier abort wins", async () => {
    vi.useFakeTimers();

    const deadline = Deadline.after(100);
    const attempt = new AbortController();
    const signal = deadline.compose(attempt.signal);
    const aborted = new Promise<unknown>((resolve) =>
      signal.addEventListener("abort", () => resolve(signal.reason), {
        once: true,
      }),
    );

    attempt.abort(new TimeoutError({ budget: "step", limitMs: 20 }));

    await expect(aborted).resolves.toMatchObject({
      budget: "step",
      limitMs: 20,
    });
    expect(deadline.signal.aborted).toBe(false);

    deadline.dispose();
  });
});
