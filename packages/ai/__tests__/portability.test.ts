import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("AI SDK portable entrypoint", () => {
  it("does not reach Node built-ins from the package root", async () => {
    const result = await build({
      entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(Object.keys(result.metafile.inputs).join("\n")).not.toContain(
      "vitest/",
    );
    expect(result.outputFiles[0]?.text).not.toMatch(
      /(?:from\s+|import\s+)["']node:/,
    );
  });
});
