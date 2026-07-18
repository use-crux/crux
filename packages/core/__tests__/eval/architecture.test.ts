import { readdir, readFile } from "node:fs/promises";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const internalDir = new URL("../../src/eval/internal/", import.meta.url);

describe("portable Eval kernel architecture", () => {
  it("keeps every internal module free of Node and provider imports", async () => {
    const files = (await readdir(internalDir)).filter((file) =>
      file.endsWith(".ts"),
    );
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(new URL(file, internalDir), "utf8");
      if (
        /(?:from\s+|import\s*\()["'](?:node:|ai(?:["'/])|@ai-sdk\/|@use-crux\/(?:ai|openai|anthropic|google|convex|next))/.test(
          source,
        )
      ) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("bundles the planner/executor facade for a browser Worker", async () => {
    const result = await build({
      stdin: {
        contents:
          'export { planEval } from "./src/eval/internal/planner"; export { executeEvalPlan } from "./src/eval/internal/executor";',
        resolveDir: new URL("../..", import.meta.url).pathname,
        sourcefile: "eval-kernel-worker-smoke.ts",
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      write: false,
    });

    expect(result.errors).toEqual([]);
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs).toContain("src/eval/internal/planner.ts");
    expect(inputs).toContain("src/eval/internal/executor.ts");
    expect(inputs.some((input) => /(^|\/)node:/.test(input))).toBe(false);
  });
});
