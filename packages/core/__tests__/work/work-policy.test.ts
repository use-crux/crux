import { describe, expect, it } from "vitest";
import { prompt, workPolicy } from "../../src/index.ts";

describe("workPolicy", () => {
  it("creates a deeply frozen work policy contribution with normalized fields", () => {
    const policy = workPolicy({
      concurrency: 4,
      maxOutstanding: 16,
      tree: { maxDepth: 2, maxStarts: 64, maxActive: 16 },
    });

    expect(policy._tag).toBe("WorkPolicy");
    expect(policy.concurrency).toBe(4);
    expect(policy.maxOutstanding).toBe(16);
    expect(policy.tree.maxDepth).toBe(2);
    expect(policy.tree.maxStarts).toBe(64);
    expect(policy.tree.maxActive).toBe(16);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.tree)).toBe(true);
  });

  it("carries immutable protected Work policy metadata through prompt resolution and merges by minimum/intersection", async () => {
    const single = await prompt({
      use: [workPolicy({ concurrency: 4, tree: { maxDepth: 2 } })],
      system: "static system",
    }).resolve({});

    expect(single.workPolicy).toEqual({ concurrency: 4, tree: { maxDepth: 2 } });
    expect(Object.isFrozen(single.workPolicy)).toBe(true);
    expect(Object.isFrozen(single.workPolicy?.tree)).toBe(true);

    const merged = await prompt({
      use: [
        workPolicy({ concurrency: 4, tree: { maxDepth: 2 } }),
        workPolicy({ concurrency: 8, maxOutstanding: 16, tree: { maxStarts: 64 } }),
      ],
      system: "static system",
    }).resolve({});

    expect(merged.workPolicy).toEqual({
      concurrency: 4,
      maxOutstanding: 16,
      tree: { maxDepth: 2, maxStarts: 64 },
    });
    expect(Object.isFrozen(merged.workPolicy)).toBe(true);
  });
});
