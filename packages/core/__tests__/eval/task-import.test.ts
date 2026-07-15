import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Eval task protocol import graph", () => {
  it("resolves the package subpath without Node or provider runtime dependencies", async () => {
    const result = await build({
      stdin: {
        contents: 'export * from "@use-crux/core/eval/internal/task";',
        resolveDir: new URL("../..", import.meta.url).pathname,
        sourcefile: "eval-task-subpath-smoke.ts",
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
    expect(inputs).toContain("src/eval/internal/task.ts");
    const forbiddenInputs = inputs.filter(
      (input) =>
        /(^|\/)node:/.test(input) ||
        /node_modules\/(?:ai|@ai-sdk|@use-crux\/(?:ai|openai|anthropic|google))(?:\/|$)/.test(
          input,
        ) ||
        /(^|\/)(?:ai|openai|anthropic|google)\/src\//.test(input) ||
        /(^|\/)src\/(?:.*\/)?(?:provider|provider-runtime|runtime)(?:\/|$)/.test(
          input,
        ),
    );
    expect(forbiddenInputs).toEqual([]);
    expect(result.outputFiles[0]?.text).not.toMatch(
      /(?:from\s+|import\s+)["'](?:node:|ai(?:["'/])|@ai-sdk\/|@use-crux\/(?:ai|openai|anthropic|google))/,
    );
  });
});
