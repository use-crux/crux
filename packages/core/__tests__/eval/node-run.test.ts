import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "../../src/eval";
import { runEval } from "../../src/eval/node";
import { runDiscoveredEval } from "../../src/eval/node/runner";
import { createEvalRunFileStore } from "../../src/eval/node/stores";
import {
  fingerprintEvalPersistencePolicy,
  normalizeEvalPersistencePolicy,
} from "../../src/eval/internal/redact";

const originalCwd = process.cwd();
const projectRoot = dirname(
  fileURLToPath(
    new URL("./fixtures/node-run-project/package.json", import.meta.url),
  ),
);
const duplicateRoot = dirname(
  fileURLToPath(
    new URL("./fixtures/node-run-duplicate/package.json", import.meta.url),
  ),
);

describe.sequential("runEval", () => {
  beforeAll(async () => {
    process.chdir(projectRoot);
    await rm(join(projectRoot, ".crux"), { recursive: true, force: true });
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(join(projectRoot, ".crux"), { recursive: true, force: true });
  });

  it("rejects an unbranded value and an Eval without an explicit id before discovery", async () => {
    await expect(runEval({} as never, { plan: true })).rejects.toThrow(
      /runEval\(\).*Eval created by evaluate/i,
    );
    await expect(
      runEval(
        evaluate({
          task: async (input: { question: string }) => input.question,
          cases: [{ input: { question: "hello" } }],
        }),
        { plan: true },
      ),
    ).rejects.toThrow(/object form.*explicit.*id.*string/i);
  });

  it("discovers a path-derived string selector and plans without writes", async () => {
    const plan = await runEval("support", { plan: true });

    expect(plan).toMatchObject({
      evalId: "support",
      sourceKey: {
        relativeFile: "evals/support.eval.ts",
        export: "default",
      },
      cells: [
        expect.objectContaining({
          caseId: "support-case",
          action: { kind: "skip", reason: "source_skipped" },
        }),
      ],
    });
    await expect(access(join(projectRoot, ".crux"))).rejects.toThrow();
  });

  it("keeps strict-offline planning independent from Runtime adapter loading", async () => {
    const configPath = join(projectRoot, "crux.config.ts");
    const generated = join(projectRoot, ".crux/generated/runtime");
    const policy = normalizeEvalPersistencePolicy({
      redactPaths: ["question"],
    });
    await mkdir(generated, { recursive: true });
    await writeFile(
      join(generated, "privacy.json"),
      JSON.stringify({
        schemaVersion: 1,
        privacyFingerprint: fingerprintEvalPersistencePolicy(policy),
        redactPaths: policy.redactPaths,
      }),
      "utf8",
    );
    await writeFile(
      configPath,
      `throw new Error("offline imported Runtime adapter config");\n`,
      "utf8",
    );
    try {
      await expect(
        runDiscoveredEval(
          "support",
          { offline: true, plan: true },
          projectRoot,
        ),
      ).resolves.toMatchObject({
        evalId: "support",
        hostReadiness: { status: "local" },
      });
    } finally {
      await rm(configPath, { force: true });
      await rm(join(projectRoot, ".crux"), { recursive: true, force: true });
    }
  });

  it("executes the same discovered string path through the portable coordinator", async () => {
    const run = await runEval("support");

    expect(run).toMatchObject({
      status: "complete",
      evalId: "support",
      cells: [{ caseId: "support-case", status: "skipped" }],
    });
  });

  it("persists the eval.case root id and only actually captured signals", async () => {
    const run = await runEval("executable");

    expect(run.cells[0]).toMatchObject({
      status: "passed",
      runIds: [expect.stringMatching(/^run_[0-9a-f]{24}$/u)],
      capturedSignals: [],
    });
    expect(run.cells[0]?.runIds[0]).not.toBe(run.cells[0]?.response?.runId);

    const reused = await runEval("executable");
    expect(reused.cells[0]).toMatchObject({
      task: { status: "reused", reason: "exact_evidence" },
      runIds: run.cells[0]?.runIds,
      capturedSignals: [],
    });
  });

  it("terminalizes an Eval-owned in-memory Knowledge Base on success and failure", async () => {
    const fixture = await import(
      "./fixtures/node-run-project/evals/knowledge-lifecycle.eval"
    );
    const success = await runDiscoveredEval(
      "knowledge-lifecycle",
      { case: "success", confirmUnknownCost: true, fresh: true },
      projectRoot,
    );
    if ("schemaVersion" in success && success.schemaVersion === 1) {
      throw new TypeError("Expected an Eval run.");
    }

    expect(success).toMatchObject({
      status: "complete",
      passed: true,
      cells: [
        {
          caseId: "success",
          status: "passed",
          task: { status: "executed" },
          capturedSignals: [],
          output: {
            assertions: 2,
            reports: expect.any(Number),
            indexedChunks: 2,
          },
        },
      ],
    });
    expect(success.endedAt).toBeGreaterThanOrEqual(success.startedAt);
    expect(
      (success.cells[0]?.output as { reports: number }).reports,
    ).toBeGreaterThan(0);
    await expect(
      createEvalRunFileStore({ projectRoot }).read(success.runId),
    ).resolves.toMatchObject({
      status: "found",
      run: {
        runId: success.runId,
        status: "complete",
        cells: [{ status: "passed" }],
      },
    });
    await expect(
      fixture.inspectKnowledgeLifecycle("success"),
    ).resolves.toMatchObject({
        communities: "ready",
        assertions: 2,
        inspection: { lifecycle: { indexedChunks: 2, indexedSources: 1 } },
    });

    const failure = await runDiscoveredEval(
      "knowledge-lifecycle",
      { case: "failure", confirmUnknownCost: true, fresh: true },
      projectRoot,
    );
    if ("schemaVersion" in failure && failure.schemaVersion === 1) {
      throw new TypeError("Expected an Eval run.");
    }

    expect(failure).toMatchObject({
      status: "incomplete",
      passed: false,
      reasons: ["task_error"],
      cells: [
        {
          caseId: "failure",
          status: "errored",
          task: { status: "errored" },
          capturedSignals: [],
        },
      ],
    });
    expect(failure.endedAt).toBeGreaterThanOrEqual(failure.startedAt);
    await expect(
      createEvalRunFileStore({ projectRoot }).read(failure.runId),
    ).resolves.toMatchObject({
      status: "found",
      run: {
        runId: failure.runId,
        status: "incomplete",
        cells: [{ status: "errored" }],
      },
    });
    await expect(
      fixture.inspectKnowledgeLifecycle("failure"),
    ).resolves.toMatchObject({
        communities: "ready",
        assertions: 2,
        inspection: { lifecycle: { indexedChunks: 2, indexedSources: 1 } },
    });
  });

  it("reuses task evidence after an assertion-only Eval source edit", async () => {
    const path = join(projectRoot, "evals/assessment-edit.eval.ts");
    const authored = await readFile(path, "utf8");
    try {
      const first = await runEval("assessment-edit");
      await writeFile(
        path,
        authored.replace('toBe("run")', 'toContain("run")'),
        "utf8",
      );
      const reassessed = await runEval("assessment-edit");

      expect(first.cells[0]?.task.status).toBe("executed");
      expect(reassessed.cells[0]?.task).toMatchObject({
        status: "reused",
        reason: "exact_evidence",
      });
    } finally {
      await writeFile(path, authored, "utf8");
    }
  }, 20_000);

  it("misses task evidence after an imported task dependency edit", async () => {
    const path = join(projectRoot, "task.ts");
    const authored = await readFile(path, "utf8");
    try {
      await runEval("assessment-edit");
      await writeFile(path, `${authored}\n// authored task revision\n`, "utf8");
      const changed = await runEval("assessment-edit");

      expect(changed.cells[0]?.task).toMatchObject({
        status: "executed",
        reason: "no_exact_evidence",
      });
    } finally {
      await writeFile(path, authored, "utf8");
    }
  }, 20_000);

  it("reuses task evidence after a deterministic scorer-only source edit", async () => {
    const path = join(projectRoot, "scorer.ts");
    const authored = await readFile(path, "utf8");
    try {
      await runEval("assessment-edit");
      await writeFile(path, authored.replace("score: 1", "score: 0.9"), "utf8");
      const rescored = await runEval("assessment-edit");

      expect(rescored.cells[0]?.task).toMatchObject({
        status: "reused",
        reason: "exact_evidence",
      });
      expect(rescored.cells[0]?.scores[0]).toMatchObject({
        status: "computed",
        reason: "deterministic_local",
      });
    } finally {
      await writeFile(path, authored, "utf8");
    }
  }, 20_000);

  it("runs an opaque callable locally without pretending it is reusable", async () => {
    const run = await runDiscoveredEval(
      "opaque",
      { confirmUnknownCost: true },
      projectRoot,
    );

    if ("schemaVersion" in run && run.schemaVersion === 1) {
      throw new TypeError("Expected an Eval run.");
    }

    expect(run.cells[0]).toMatchObject({
      status: "passed",
      output: "WORKS",
      task: { status: "executed", reason: "identity_unavailable" },
      runIds: [expect.stringMatching(/^run_[0-9a-f]{24}$/u)],
    });
    expect(run.cells[0]).not.toHaveProperty("response");
  }, 20_000);

  it("explains how to make an unknown hard-cap estimate actionable", async () => {
    await expect(
      runDiscoveredEval("opaque", { maxCostUsd: 1 }, projectRoot),
    ).rejects.toThrow(
      /Use a managed AI task and configure experimental\.eval\.pricing with maxUsdPerCall ceilings/,
    );
  }, 10_000);

  it("runs fresh when an authored source dependency cannot be proven", async () => {
    const plan = await runEval("dynamic-prompt", {
      plan: true,
      confirmUnknownCost: true,
    });

    expect(plan.cells[0]?.action).toEqual({
      kind: "execute",
      reason: "unresolved_source_dependency",
    });
  });

  it("runs an inline managed task fresh with a precise binding remedy", async () => {
    const plan = await runEval("inline-task", { plan: true });

    expect(plan.cells[0]?.action).toEqual({
      kind: "execute",
      reason: "task_binding_untracked",
    });
  });

  it("demotes only an inline replacement arm when its binding is untracked", async () => {
    const first = await runEval("inline-replacement");
    const second = await runEval("inline-replacement");

    expect(first.cells.map((cell) => cell.task.status)).toEqual([
      "executed",
      "executed",
    ]);
    expect(second.cells.map((cell) => cell.task)).toMatchObject([
      { status: "reused", reason: "exact_evidence" },
      { status: "executed", reason: "task_binding_untracked" },
    ]);
  }, 20_000);

  it("reuses imported replacement task arms through the real coordinator", async () => {
    const first = await runEval("replacement");
    const second = await runEval("replacement");

    expect(first.cells.map((cell) => cell.task.status)).toEqual([
      "executed",
      "executed",
    ]);
    expect(second.cells.map((cell) => cell.task)).toMatchObject([
      { status: "reused", reason: "exact_evidence" },
      { status: "reused", reason: "exact_evidence" },
    ]);
  }, 20_000);

  it("invalidates only the edited imported replacement task binding", async () => {
    const path = join(projectRoot, "replacement-task.ts");
    const authored = await readFile(path, "utf8");
    try {
      await runEval("replacement");
      await writeFile(path, `${authored}\n// candidate revision\n`, "utf8");
      const changed = await runEval("replacement");

      expect(
        changed.cells.map((cell) => ({
          variant: cell.variant,
          task: cell.task,
        })),
      ).toMatchObject([
        {
          variant: "current",
          task: { status: "reused", reason: "exact_evidence" },
        },
        {
          variant: "replacement",
          task: { status: "executed", reason: "no_exact_evidence" },
        },
      ]);
    } finally {
      await writeFile(path, authored, "utf8");
    }
  }, 20_000);

  it("validates inline Case inputs through the managed task schema", async () => {
    await expect(runEval("invalid-inline", { plan: true })).rejects.toThrow(
      /invalid-inline\.eval\.ts:inline:1.*input failed schema validation.*string/i,
    );
  });

  it("accepts only the exact discovered default export and its re-export", async () => {
    const imported =
      await import("./fixtures/node-run-project/evals/object.eval");
    const reexport =
      await import("./fixtures/node-run-project/object-reexport");
    expect(Object.is(imported.default, reexport.default)).toBe(true);

    const byObject = await runEval(imported.default, { plan: true });
    const byString = await runEval("object", { plan: true });
    const byReexport = await runEval(reexport.default, { plan: true });
    expect(byObject.definitionFingerprint).toBe(byString.definitionFingerprint);
    expect(byObject.cells).toEqual(byString.cells);
    expect(byReexport.definitionFingerprint).toBe(
      byString.definitionFingerprint,
    );
  }, 20_000);

  it("rejects a separately constructed same-id Eval before hydration or planning", async () => {
    const { task } = await import("./fixtures/node-run-project/task");
    const lookalike = evaluate({
      id: "object",
      task,
      cases: [{ id: "object-case", input: { question: "object" }, skip: true }],
    });

    await expect(runEval(lookalike, { plan: true })).rejects.toThrow(
      /not the exact default export.*object\.eval\.ts.*Import and pass.*runEval\('object'\).*HMR.*evaluate\(\).*alias\/symlink/is,
    );
    await expect(runEval("missing", { plan: true })).rejects.toThrow(
      /No Eval matches 'missing'/,
    );
  });

  it("applies the exact identity gate before Case hydration", async () => {
    const { task } = await import("./fixtures/node-run-project/task");
    const lookalike = evaluate({
      id: "guard",
      task,
      cases: [{ input: { question: "not the missing file" } }],
    });

    await expect(runEval(lookalike, { plan: true })).rejects.toThrow(
      /not the exact default export.*guard\.eval\.ts/is,
    );
    await expect(runEval("guard", { plan: true })).rejects.toThrow(
      /fixtures\/missing\.json.*does not exist/i,
    );
  });

  it("preserves duplicate-discovery errors ahead of object identity", async () => {
    process.chdir(duplicateRoot);
    try {
      const imported =
        await import("./fixtures/node-run-duplicate/evals/a.eval");
      await expect(runEval(imported.default, { plan: true })).rejects.toThrow(
        /Duplicate Eval id 'duplicate'.*a\.eval\.ts.*b\.eval\.ts/is,
      );
    } finally {
      process.chdir(projectRoot);
    }
  });
});
