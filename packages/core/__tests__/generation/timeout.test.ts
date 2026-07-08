import { afterEach, describe, expect, it, vi } from "vitest";
import { Deadline, TimeoutError, withBudget } from "../../generation/timeout";

afterEach(() => {
  vi.useRealTimers();
});

describe("generation timeout budgets", () => {
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
