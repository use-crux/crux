import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";

describe("runtime isolate bundle compatibility", () => {
  it("bundles public runtime subpaths and Convex component sources for platform-neutral isolates", async () => {
    const repoRoot = resolve("../..");
    const dir = await mkdtemp(join(tmpdir(), "crux-runtime-isolate-"));
    const entry = join(dir, "entry.ts");
    await writeFile(
      entry,
      [
        "import '@use-crux/core'",
        "import '@use-crux/core/observability'",
        "import '@use-crux/core/transcription'",
        "import '@use-crux/core/runtime'",
        "import '@use-crux/core/internal/async-scope'",
        "import '@use-crux/core/internal/defer-host'",
        "import '@use-crux/core/internal/defer-lifecycle'",
        "import '@use-crux/convex/runtime'",
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/events.ts",
        ),
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/leases.ts",
        ),
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/outbox.ts",
        ),
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/state.ts",
        ),
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/timers.ts",
        ),
        importStatement(
          repoRoot,
          "packages/convex/src/component/runtime/waiters.ts",
        ),
      ].join("\n"),
    );

    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "esm",
      platform: "neutral",
      packages: "bundle",
      logLevel: "silent",
      absWorkingDir: repoRoot,
      plugins: [workspacePackagePlugin(repoRoot)],
    });

    expect(result.outputFiles).toHaveLength(1);
  });
});

function importStatement(root: string, path: string): string {
  return `import ${JSON.stringify(resolve(root, path))}`;
}

function workspacePackagePlugin(repoRoot: string): Plugin {
  return {
    name: "crux-workspace-package-subpaths",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@use-crux\/core(\/.*)?$/ }, (args) => ({
        path: resolve(repoRoot, coreSubpath(args.path)),
      }));
      buildApi.onResolve({ filter: /^@use-crux\/convex\/runtime$/ }, () => ({
        path: resolve(repoRoot, "packages/convex/src/runtime.ts"),
      }));
    },
  };
}

function coreSubpath(specifier: string): string {
  if (specifier === "@use-crux/core") return "packages/core/src/index.ts";
  const subpath = specifier.slice("@use-crux/core/".length);
  if (subpath === "runtime") return "packages/core/src/runtime/public.ts";
  if (subpath === "observability")
    return "packages/core/src/observability/index.ts";
  if (subpath === "storage") return "packages/core/src/storage/index.ts";
  if (subpath === "internal/async-scope")
    return "packages/core/src/async-scope/index.ts";
  if (subpath === "internal/defer-host")
    return "packages/core/src/defer/host.ts";
  if (subpath === "internal/defer-lifecycle")
    return "packages/core/src/defer/lifecycle.ts";
  if (subpath === "transcription")
    return "packages/core/src/transcription/index.ts";
  return `packages/core/src/${subpath}.ts`;
}
