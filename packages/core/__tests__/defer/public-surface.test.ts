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

describe("defer package surfaces", () => {
  it("exports authored defer only from the Core root", () => {
    expect(typeof core.defer).toBe("function");
    expect(runtime).not.toHaveProperty("defer");
    expect(runtime).not.toHaveProperty("runWithDeferInvocation");
  });

  it("folds the first-party defer SPI into the scope subpath", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./internal/scope"]).toEqual({
      types: "./src/scope/internal.ts",
      import: "./src/scope/internal.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["internal/scope"]).toEqual([
      "src/scope/internal.ts",
    ]);
    expect(await import("@use-crux/core/internal/scope")).toHaveProperty(
      "runWithDeferInvocation",
    );
  });

  it("does not expose raw invocation scope or drain controls", async () => {
    const scope = await import("@use-crux/core/internal/scope");

    expect(scope).not.toHaveProperty("seal");
    expect(scope).not.toHaveProperty("registerInline");
    expect(core).not.toHaveProperty("runWithDeferInvocation");
    expect(core).not.toHaveProperty("scheduleDiagnosticsOnlyDeferredCallback");
    expect(runtime).not.toHaveProperty(
      "scheduleDiagnosticsOnlyDeferredCallback",
    );
    expect(scope).not.toHaveProperty("scheduleDiagnosticsOnlyDeferredCallback");
  });

  it("does not declare a diagnostics-only defer package subpath", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports).not.toHaveProperty("./internal/defer-port");
    expect(manifest.typesVersions?.["*"]).not.toHaveProperty(
      "internal/defer-port",
    );
  });
});
