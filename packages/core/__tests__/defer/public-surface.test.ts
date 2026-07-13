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

  it("declares the exact first-party defer-host SPI subpath", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    ) as CorePackageManifest;

    expect(manifest.exports?.["./internal/defer-host"]).toEqual({
      types: "./src/defer/host.ts",
      import: "./src/defer/host.ts",
    });
    expect(manifest.typesVersions?.["*"]?.["internal/defer-host"]).toEqual([
      "src/defer/host.ts",
    ]);
    expect(
      Object.keys(await import("@use-crux/core/internal/defer-host")),
    ).toEqual(["runWithDeferInvocation"]);
  });

  it("does not expose raw invocation scope or drain controls", async () => {
    const host = await import("@use-crux/core/internal/defer-host");

    expect(host).not.toHaveProperty("createInvocationDeferScope");
    expect(host).not.toHaveProperty("seal");
    expect(host).not.toHaveProperty("registerInline");
    expect(core).not.toHaveProperty("runWithDeferInvocation");
    expect(core).not.toHaveProperty("createInvocationDeferScope");
    expect(core).not.toHaveProperty("scheduleDiagnosticsOnlyDeferredCallback");
    expect(runtime).not.toHaveProperty(
      "scheduleDiagnosticsOnlyDeferredCallback",
    );
    expect(host).not.toHaveProperty("scheduleDiagnosticsOnlyDeferredCallback");
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
