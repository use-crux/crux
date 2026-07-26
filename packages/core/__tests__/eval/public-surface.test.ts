import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

interface CorePackageManifest {
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly typesVersions?: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
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
    expect(manifest.exports).not.toHaveProperty("./quality");
    expect(manifest.exports).not.toHaveProperty("./quality/schemas");
    expect(manifest.exports).not.toHaveProperty("./quality/internal/runner");

    const surface = await import("@use-crux/core/eval");
    expect(Object.keys(surface).sort()).toEqual([
      "caseFile",
      "evalContext",
      "evaluate",
      "tryEvalContext",
    ]);
    expect(surface.evaluate).toBeTypeOf("function");
    expect(surface.caseFile).toBeTypeOf("function");
    expect(surface.evalContext).toBeTypeOf("function");
    expect(surface.tryEvalContext).toBeTypeOf("function");
  });

  it("exposes only the explicit task-context installer from eval/testing", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./eval/testing"]).toEqual({
      types: "./src/eval/testing.ts",
      import: "./src/eval/testing.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["eval/testing"]).toEqual([
      "src/eval/testing.ts",
    ]);

    expect(
      Object.keys(await import("@use-crux/core/eval/testing")),
    ).toEqual(["withEvalContext"]);
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
    expect(Object.keys(surface).sort()).toEqual([
      "caseFile",
      "evalContext",
      "evaluate",
      "tryEvalContext",
    ]);
  });

  it("exposes the coordinator bridge only through its internal subpath", async () => {
    const runner = await import("@use-crux/core/eval/internal/runner");
    expect(runner.EVAL_RUNNER_PROTOCOL).toBe(1);
    expect(runner.materializeEvalForInternalUse).toBeTypeOf("function");

    const surface = await import("@use-crux/core/eval");
    expect(Object.keys(surface).sort()).toEqual([
      "caseFile",
      "evalContext",
      "evaluate",
      "tryEvalContext",
    ]);
  }, 20_000);

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
