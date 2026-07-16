import { access, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  createEvalBaselineFileStore,
  EvalBaselineMigrationError,
} from "../../src/eval/node/stores";
import { buildEvalBaseline } from "../../src/eval/internal/baseline";
import type { EvalRun } from "../../src/eval/internal/types";
import { runFixture } from "./baseline-test-harness";

describe("Eval Baseline rename migration", () => {
  it("moves one unambiguous source rename and updates its identity", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-baseline-rename-"));
    const store = createEvalBaselineFileStore({ projectRoot });
    const oldRun = atSource(runFixture({ score: 0.8 }), "evals/old.eval.ts");
    await store.write(
      buildEvalBaseline(oldRun, {
        baselineId: "baseline-old",
        promotedAt: 1,
        toolVersion: "0.5.0",
      }),
    );

    await expect(
      store.readForEval({
        sourceKey: { relativeFile: "evals/new.eval.ts" },
        evalId: "support",
        definitionFingerprint: oldRun.definitionFingerprint,
      }),
    ).resolves.toMatchObject({
      evalId: "support",
      sourceKey: { relativeFile: "evals/new.eval.ts" },
    });
    await expect(access(join(projectRoot, "evals", "new.baseline.json"))).resolves.toBeUndefined();
    await expect(access(join(projectRoot, "evals", "old.baseline.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not write when rename evidence is ambiguous or conflicts", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-baseline-ambiguous-"));
    const store = createEvalBaselineFileStore({ projectRoot });
    for (const [id, source] of [
      ["one", "evals/one.eval.ts"],
      ["two", "evals/two.eval.ts"],
    ] as const) {
      const run = {
        ...atSource(runFixture({ score: 0.8 }), source),
        evalId: id,
      } satisfies EvalRun;
      await store.write(
        buildEvalBaseline(run, {
          baselineId: `baseline-${id}`,
          promotedAt: 1,
          toolVersion: "0.5.0",
        }),
      );
    }

    await expect(
      store.readForEval({
        sourceKey: { relativeFile: "evals/renamed.eval.ts" },
        evalId: "renamed",
        definitionFingerprint: "definition-v1",
      }),
    ).rejects.toBeInstanceOf(EvalBaselineMigrationError);
    await expect(access(join(projectRoot, "evals", "renamed.baseline.json"))).rejects.toMatchObject({ code: "ENOENT" });

    const conflict = atSource(
      { ...runFixture({ score: 0.9 }), evalId: "other" },
      "evals/conflict.eval.ts",
    );
    await store.write(
      buildEvalBaseline(conflict, {
        baselineId: "baseline-conflict",
        promotedAt: 1,
        toolVersion: "0.5.0",
      }),
    );
    await expect(
      store.readForEval({
        sourceKey: { relativeFile: "evals/conflict.eval.ts" },
        evalId: "support",
        definitionFingerprint: "definition-v1",
      }),
    ).rejects.toThrow(/sibling conflict/i);
  });

  it("reports V2 as legacy truth without translating it", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "crux-baseline-v2-"));
    const directory = join(projectRoot, "evals");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "support.baseline.json"),
      JSON.stringify({ schemaVersion: 2, evaluationId: "support", reference: {} }),
    );

    await expect(
      createEvalBaselineFileStore({ projectRoot }).read({
        relativeFile: "evals/support.eval.ts",
      }),
    ).rejects.toThrow(/schemaVersion.*baseline set/s);
  });
});

function atSource(run: EvalRun, relativeFile: string): EvalRun {
  return { ...run, sourceKey: { relativeFile, export: "default" } };
}
