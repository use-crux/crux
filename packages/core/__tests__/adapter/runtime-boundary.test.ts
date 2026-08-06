import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("adapter runtime boundary", () => {
  it("does not load adapter test helpers or Vitest", async () => {
    const result = await build({
      entryPoints: [new URL("../../src/adapter/index.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "browser",
      write: false,
    });
    const inputs = Object.keys(result.metafile.inputs).join("\n");

    expect(inputs).not.toContain("adapter/testing/");
    expect(inputs).not.toContain("vitest/");
  });
});
