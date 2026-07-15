import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Project Index manifest runtime boundary", () => {
  it("keeps the portable contract disconnected from compiler and hashing code", async () => {
    const entryPoint = new URL(
      "../../src/project-index/index.ts",
      import.meta.url,
    ).pathname;
    const result = await build({
      entryPoints: [entryPoint],
      bundle: true,
      write: false,
      metafile: true,
      platform: "browser",
      format: "esm",
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile.inputs).join("\n");
    const bundled = result.outputFiles[0]!.text;

    expect(result.errors).toEqual([]);
    expect(inputs).not.toContain("packages/indexer");
    expect(inputs).not.toContain("deployment-manifest/canonical");
    expect(bundled).not.toContain("node:crypto");
    expect(bundled).not.toContain("createHash");
  });
});
