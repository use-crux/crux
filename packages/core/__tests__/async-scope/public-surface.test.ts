import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import * as core from "@use-crux/core";
import * as runtime from "@use-crux/core/runtime";

interface CorePackageManifest {
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly typesVersions?: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
}

describe("@use-crux/core/internal/async-scope", () => {
  it("declares the first-party async-scope SPI as an exact package subpath", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./internal/async-scope"]).toEqual({
      types: "./src/async-scope/index.ts",
      import: "./src/async-scope/index.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["internal/async-scope"]).toEqual([
      "src/async-scope/index.ts",
    ]);
    expect(
      Object.keys(await import("@use-crux/core/internal/async-scope")),
    ).toEqual(["createAsyncScopeFacet"]);
  });

  it("does not expose carrier internals from root or Runtime public surfaces", () => {
    expect(core).not.toHaveProperty("createAsyncScopeFacet");
    expect(runtime).not.toHaveProperty("createAsyncScopeFacet");
    expect(core).not.toHaveProperty("currentAsyncScope");
    expect(runtime).not.toHaveProperty("currentAsyncScope");
  });
});
