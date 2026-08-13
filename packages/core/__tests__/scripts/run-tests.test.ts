import { describe, expect, it } from "vitest";
import {
  createTestPhases,
  isolatedTests,
} from "../../scripts/run-tests.mjs";

describe("Core test runner", () => {
  it("runs isolation-sensitive Eval files in fresh, argument-preserving phases", () => {
    const args = ["--maxWorkers=1", "--maxConcurrency=1"];

    expect(createTestPhases(args)).toEqual([
      [
        "run",
        "--exclude",
        isolatedTests[0],
        "--exclude",
        isolatedTests[1],
        ...args,
      ],
      ["run", isolatedTests[0], ...args],
      ["run", isolatedTests[1], ...args],
    ]);
  });
});
