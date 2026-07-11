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
  it("declares exact public Node and internal lifecycle subpaths", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./defer/node"]).toEqual({
      types: "./src/defer/node.ts",
      import: "./src/defer/node.ts",
    });
    expect(manifest.exports?.["./internal/defer-lifecycle"]).toEqual({
      types: "./src/defer/lifecycle.ts",
      import: "./src/defer/lifecycle.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["defer/node"]).toEqual([
      "src/defer/node.ts",
    ]);
    expect(manifest.typesVersions?.["*"]?.["internal/defer-lifecycle"]).toEqual(
      ["src/defer/lifecycle.ts"],
    );
    expect(
      Object.keys(await import("@use-crux/core/defer/node")).sort(),
    ).toEqual(["createNodeDeferHost", "shutdownNodeDefer", "withNodeDefer"]);
    expect(
      Object.keys(await import("@use-crux/core/internal/defer-lifecycle")),
    ).toEqual([
      "createHandlerReturnedDeferLifetime",
      "createResponseFinishedDeferLifetime",
    ]);
  });

  it("keeps Node lifecycle bindings out of root and Runtime surfaces", () => {
    for (const surface of [core, runtime]) {
      expect(surface).not.toHaveProperty("withNodeDefer");
      expect(surface).not.toHaveProperty("createNodeDeferHost");
      expect(surface).not.toHaveProperty("createHandlerReturnedDeferLifetime");
    }
  });
});
