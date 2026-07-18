import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDiscoveredEval } from "@use-crux/core/eval/internal/node-runner";

const projectRoot = dirname(
  fileURLToPath(
    new URL("./fixtures/eval-identity-project/package.json", import.meta.url),
  ),
);
const originalCwd = process.cwd();
let initialPureRun: Awaited<ReturnType<typeof run>>;

async function run(selector: string) {
  const result = await runDiscoveredEval(
    selector,
    { confirmUnknownCost: true },
    projectRoot,
  );
  if ("provenance" in result) return result;
  throw new TypeError("Expected an executed Eval run.");
}

describe.sequential("imported AI task identity", () => {
  beforeAll(async () => {
    process.chdir(projectRoot);
    await rm(join(projectRoot, ".crux"), { recursive: true, force: true });
    initialPureRun = await run("pure-identity");
  }, 30_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(join(projectRoot, ".crux"), { recursive: true, force: true });
  });

  it("reuses task evidence after an assertion-only edit", async () => {
    const path = join(projectRoot, "evals/pure.eval.ts");
    const source = await readFile(path, "utf8");
    try {
      expect(initialPureRun.provenance.evidenceStore).toMatchObject({
        write: "written",
      });
      await writeFile(path, source.replace("toBe", "toEqual"), "utf8");
      const changed = await run("pure-identity");
      expect(changed.cells[0]?.task).toMatchObject({
        status: "reused",
        reason: "exact_evidence",
      });
    } finally {
      await writeFile(path, source, "utf8");
    }
  }, 30_000);

  it("misses after imported pure Context implementation and tool schema edits", async () => {
    const path = join(projectRoot, "contexts.ts");
    const source = await readFile(path, "utf8");
    try {
      await writeFile(
        path,
        source.replace("verified support facts", "reviewed support facts"),
        "utf8",
      );
      const contextChanged = await run("pure-identity");
      expect(contextChanged.cells[0]?.task).toMatchObject({
        status: "executed",
        reason: "no_exact_evidence",
      });

      await writeFile(
        path,
        source.replace("z.string()", "z.number()"),
        "utf8",
      );
      const toolChanged = await run("pure-identity");
      expect(toolChanged.cells[0]?.task).toMatchObject({
        status: "executed",
        reason: "no_exact_evidence",
      });
    } finally {
      await writeFile(path, source, "utf8");
    }
  }, 30_000);

  it("keeps effectful tools and Context tool factories fresh", async () => {
    const tool = await run("effectful-tool");
    const context = await run("effectful-context");

    expect(tool.cells).toHaveLength(2);
    expect(context.cells).toHaveLength(2);
    for (const cell of [...tool.cells, ...context.cells]) {
      expect(cell.task).toMatchObject({
        status: "executed",
        reason: "untracked_external_dependency",
      });
    }
  }, 30_000);
});
