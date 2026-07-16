import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface CorePackageManifest {
  readonly exports?: Readonly<Record<string, unknown>>;
}

describe("@use-crux/core/eval", () => {
  it("resolves from the conditional package export with an exact runtime surface", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./eval"]).toEqual({
      types: "./src/eval/index.ts",
      import: "./src/eval/index.ts",
    });

    const surface = await import("@use-crux/core/eval");
    expect(Object.keys(surface).sort()).toEqual(["caseFile", "evaluate"]);
    expect(surface.evaluate).toBeTypeOf("function");
    expect(surface.caseFile).toBeTypeOf("function");
  });

  it("resolves the internal task protocol without widening the Eval root", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./eval/internal/task"]).toEqual({
      types: "./src/eval/internal/task.ts",
      import: "./src/eval/internal/task.ts",
    });
    const protocol = await import("@use-crux/core/eval/internal/task");
    expect(protocol.executeEvalTaskForInternalUse).toBeTypeOf("function");

    const surface = await import("@use-crux/core/eval");
    expect(Object.keys(surface).sort()).toEqual(["caseFile", "evaluate"]);
  });

  it("exposes the coordinator bridge only through its internal subpath", async () => {
    const runner = await import("@use-crux/core/eval/internal/runner");
    expect(runner.EVAL_RUNNER_PROTOCOL).toBe(1);
    expect(runner.materializeEvalForInternalUse).toBeTypeOf("function");

    const surface = await import("@use-crux/core/eval");
    expect(Object.keys(surface).sort()).toEqual(["caseFile", "evaluate"]);
  });

  it("exposes only runEval as the Node runtime API", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;
    expect(manifest.exports?.["./eval/node"]).toEqual({
      types: "./src/eval/node.ts",
      import: "./src/eval/node.ts",
    });
    expect(manifest.exports?.["./eval/internal/node-runner"]).toEqual({
      types: "./src/eval/node/runner.ts",
      import: "./src/eval/node/runner.ts",
    });

    const surface = await import("@use-crux/core/eval/node");
    expect(Object.keys(surface)).toEqual(["runEval"]);
  });
});
