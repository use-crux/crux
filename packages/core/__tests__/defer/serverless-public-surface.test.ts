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

describe("serverless defer package surfaces", () => {
  it("declares the public serverless subpath and keeps wrappers off root", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./defer/serverless"]).toEqual({
      types: "./src/defer/serverless.ts",
      import: "./src/defer/serverless.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["defer/serverless"]).toEqual([
      "src/defer/serverless.ts",
    ]);

    const surface = await import("@use-crux/core/defer/serverless");
    expect(Object.keys(surface).sort()).toEqual(
      [
        "SERVERLESS_DEFER_POLICY",
        "createAfterDeferLifetime",
        "createNamedOnlyDeferLifetime",
        "createWaitUntilDeferLifetime",
        "withAfterDefer",
        "withNamedOnlyDefer",
        "withServerlessDefer",
        "withWaitUntilDefer",
      ].sort(),
    );

    for (const packageSurface of [core, runtime]) {
      expect(packageSurface).not.toHaveProperty("withWaitUntilDefer");
      expect(packageSurface).not.toHaveProperty("withAfterDefer");
      expect(packageSurface).not.toHaveProperty("withNamedOnlyDefer");
      expect(packageSurface).not.toHaveProperty("createWaitUntilDeferLifetime");
    }
  });
});
