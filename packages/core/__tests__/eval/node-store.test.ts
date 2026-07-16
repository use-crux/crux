import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";

import {
  createEvalEvidenceFileStore,
  createEvalRunFileStore,
  evalRunV3Schema,
  isEvalRunPromotable,
} from "../../src/eval/node";
import { executeEvalPlan } from "../../src/eval/internal/executor";
import { planEval } from "../../src/eval/internal/planner";
import {
  evalValue,
  planningPorts,
  taskResult,
} from "./reuse-test-harness";

const source = {
  sourceKey: { relativeFile: "support.eval.ts", export: "default" as const },
};

describe("Node Eval V3 stores", () => {
  it("validates the shared golden while preserving additive fields", async () => {
    const raw = JSON.parse(
      await readFile(
        new URL("./fixtures/run-v3.golden.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;

    expect(evalRunV3Schema.parse(raw)).toMatchObject({
      futureTopLevelField: { producer: "future-core", revision: 4 },
      cells: [{ futureCellField: { preserve: true } }],
    });
  });

  it("atomically round-trips a complete run from the terminal boundary", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-run-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const evidenceStore = createEvalEvidenceFileStore({ projectRoot });
    const run = await executeEvalPlan(
      await planEval(evalValue(), source, planningPorts(evidenceStore)),
      {
        evidenceStore,
        taskHost: { execute: async () => taskResult() },
        clock: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
        ids: { next: () => "eval-run-1" },
        runStore,
      },
    );

    await expect(runStore.read("eval-run-1")).resolves.toEqual({
      status: "found",
      run,
    });
    expect(isEvalRunPromotable(run)).toBe(true);
  });

  it("persists an incomplete run as non-promotable terminal evidence", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-error-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const run = await executeEvalPlan(await planEval(evalValue(), source), {
      taskHost: {
        execute: async () => {
          throw new Error("provider unavailable");
        },
      },
      clock: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
      ids: { next: () => "eval-run-error" },
      runStore,
    });

    expect(run).toMatchObject({ status: "incomplete", passed: false });
    expect(isEvalRunPromotable(run)).toBe(false);
    await expect(runStore.read("eval-run-error")).resolves.toMatchObject({
      status: "found",
      run: { status: "incomplete", passed: false },
    });
  });

  it("reports corrupt final records and ignores abandoned temporary files", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-corrupt-"));
    const runStore = createEvalRunFileStore({ projectRoot });
    const runsDir = join(projectRoot, ".crux", "quality", "runs");
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, "corrupt.json"), '{"schemaVersion":3', "utf8");
    await writeFile(
      join(runsDir, "abandoned.json.partial.tmp"),
      '{"schemaVersion":3}',
      "utf8",
    );

    await expect(runStore.read("corrupt")).resolves.toMatchObject({
      status: "corrupt",
      error: expect.any(String),
    });
    await expect(runStore.read("abandoned")).resolves.toEqual({
      status: "missing",
    });
  });

  it("reuses exact evidence after reopening the filesystem store", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-eval-cache-"));
    const firstStore = createEvalEvidenceFileStore({ projectRoot });
    const execute = vi.fn(async () => taskResult());
    await executeEvalPlan(
      await planEval(evalValue(), source, planningPorts(firstStore)),
      {
        evidenceStore: firstStore,
        taskHost: { execute },
        clock: { now: () => 1 },
        ids: { next: () => "eval-run-1" },
        runStore: { write: async () => undefined },
      },
    );

    const reopened = createEvalEvidenceFileStore({ projectRoot });
    const plan = await planEval(evalValue(), source, planningPorts(reopened));

    expect(plan.cells[0]?.action).toMatchObject({
      kind: "reuse",
      reason: "exact_evidence",
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});
