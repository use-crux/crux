import { access, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluate } from "../../src/eval";
import { runEval } from "../../src/eval/node";

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
      sourceKey: { relativeFile: "evals/support.eval.ts", export: "default" },
      cells: [
        expect.objectContaining({
          caseId: "support-case",
          action: { kind: "skip", reason: "source_skipped" },
        }),
      ],
    });
    await expect(access(join(projectRoot, ".crux"))).rejects.toThrow();
  });

  it("executes the same discovered string path through the portable coordinator", async () => {
    const run = await runEval("support");

    expect(run).toMatchObject({
      status: "complete",
      evalId: "support",
      cells: [{ caseId: "support-case", status: "skipped" }],
    });
  });

  it("accepts only the exact discovered default export and its re-export", async () => {
    const imported = await import("./fixtures/node-run-project/evals/object.eval");
    const reexport = await import("./fixtures/node-run-project/object-reexport");
    expect(Object.is(imported.default, reexport.default)).toBe(true);

    const byObject = await runEval(imported.default, { plan: true });
    const byString = await runEval("object", { plan: true });
    const byReexport = await runEval(reexport.default, { plan: true });
    expect(byObject.definitionFingerprint).toBe(byString.definitionFingerprint);
    expect(byObject.cells).toEqual(byString.cells);
    expect(byReexport.definitionFingerprint).toBe(byString.definitionFingerprint);
  });

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
      const imported = await import("./fixtures/node-run-duplicate/evals/a.eval");
      await expect(runEval(imported.default, { plan: true })).rejects.toThrow(
        /Duplicate Eval id 'duplicate'.*a\.eval\.ts.*b\.eval\.ts/is,
      );
    } finally {
      process.chdir(projectRoot);
    }
  });
});
