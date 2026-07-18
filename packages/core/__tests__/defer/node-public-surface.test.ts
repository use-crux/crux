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

describe("Node defer package surfaces", () => {
  it("declares the public Node subpath and the scope kernel SPI", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./defer/node"]).toEqual({
      types: "./src/defer/node.ts",
      import: "./src/defer/node.ts",
    });
    expect(manifest.exports?.["./internal/scope"]).toEqual({
      types: "./src/scope/internal.ts",
      import: "./src/scope/internal.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["defer/node"]).toEqual([
      "src/defer/node.ts",
    ]);
    expect(manifest.typesVersions?.["*"]?.["internal/scope"]).toEqual([
      "src/scope/internal.ts",
    ]);
    expect(
      Object.keys(await import("@use-crux/core/defer/node")).sort(),
    ).toEqual([
      "createNodeDeferHost",
      "node",
      "shutdownNodeDefer",
      "withNodeDefer",
    ]);
    expect(await import("@use-crux/core/internal/scope")).not.toHaveProperty(
      "createHandlerReturnedDeferLifetime",
    );
  });

  it("keeps Node lifecycle bindings out of root and Runtime surfaces", () => {
    for (const surface of [core, runtime]) {
      expect(surface).not.toHaveProperty("withNodeDefer");
      expect(surface).not.toHaveProperty("createNodeDeferHost");
      expect(surface).not.toHaveProperty("createHandlerReturnedDeferLifetime");
    }
  });
});
