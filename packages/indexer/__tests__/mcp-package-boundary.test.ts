import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const adapterPackages = ["ai", "openai", "anthropic", "google"] as const;

interface PackageManifest {
  readonly author?: string;
  readonly engines?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly imports?: Readonly<Record<string, unknown>>;
  readonly homepage?: string;
  readonly publishConfig?: { readonly access?: string };
  readonly repository?: { readonly directory?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<
    Record<string, { readonly optional?: boolean }>
  >;
}

describe("MCP package boundary", () => {
  it("keeps MCP opt-in while one MCP install owns both client implementations", () => {
    const core = packageManifest("core");
    expect(core.dependencies ?? {}).not.toHaveProperty("@use-crux/mcp");
    expect(core.peerDependencies ?? {}).not.toHaveProperty("@use-crux/mcp");

    for (const packageName of adapterPackages) {
      const manifest = packageManifest(packageName);
      expect(manifest.dependencies ?? {}, packageName).not.toHaveProperty(
        "@use-crux/mcp",
      );
      expect(manifest.peerDependencies ?? {}, packageName).toMatchObject({
        "@use-crux/mcp": "workspace:^",
      });
      expect(manifest.peerDependenciesMeta ?? {}, packageName).toMatchObject({
        "@use-crux/mcp": { optional: true },
      });
      expect(staticMcpImports(packageName), packageName).toEqual([]);
    }

    expect(packageManifest("mcp").dependencies ?? {}).toMatchObject({
      "@use-crux/core": "workspace:*",
      "@ai-sdk/mcp": "^1.0.61",
      "@modelcontextprotocol/sdk": "^1.29.0",
      zod: "^4.4.3",
    });
  });

  it("includes MCP in compatibility checks and release staging", () => {
    const manifest = packageManifest("mcp");
    expect(manifest).toMatchObject({
      author: "Crux",
      publishConfig: { access: "public" },
      repository: { directory: "packages/mcp" },
      homepage: "https://cruxjs.dev/docs/reference/mcp",
      exports: {
        ".": expect.any(Object),
        "./testing/vitest": expect.any(Object),
      },
      imports: {
        "#ai-sdk-stdio": expect.any(Object),
        "#official-stdio": expect.any(Object),
      },
    });

    const stagingScript = readRepoFile("scripts/stage-npm-packages.mjs");
    expect(stagingScript).toMatch(
      /\{ name: ["']@use-crux\/mcp["'], dir: ["']packages\/mcp["'], sourceRoot: ["']src["'] \}/,
    );
    expect(readRepoFile("scripts/typecheck-typescript-compat.mjs")).toContain(
      "'packages/mcp'",
    );
    expect(manifest.engines).toBeUndefined();

    const releaseWorkflow = readRepoFile(".github/workflows/release.yml");
    const nightlyPackages = releaseWorkflow.match(
      /nightly_packages=\([\s\S]*?\n\s*\)/,
    )?.[0];
    expect(nightlyPackages).toBeDefined();
    const stagedPackageNames = [
      ...stagingScript.matchAll(/\{ name: ["'](@use-crux\/[^"']+)["']/g),
    ].map((match) => match[1]);
    for (const packageName of stagedPackageNames) {
      expect(nightlyPackages, packageName).toContain(packageName);
    }
    expect(productionFilesWithExplicitAny("mcp")).toEqual([]);
  });
});

function packageManifest(packageName: string): PackageManifest {
  return JSON.parse(
    readFileSync(
      join(repoRoot, "packages", packageName, "package.json"),
      "utf8",
    ),
  ) as PackageManifest;
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

function productionFilesWithExplicitAny(packageName: string): string[] {
  return sourceFiles(join(repoRoot, "packages", packageName, "src")).filter(
    (path) => /\bany\b/.test(readFileSync(path, "utf8")),
  );
}

function staticMcpImports(packageName: string): string[] {
  const sourceRoot = join(repoRoot, "packages", packageName, "src");
  return sourceFiles(sourceRoot).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return /(?:from\s+|require\(|import\s*)(['"])@use-crux\/mcp(?:\/[^'"]*)?\1/.test(
      source,
    )
      ? [path]
      : [];
  });
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.[cm]?tsx?$/.test(entry) ? [path] : [];
  });
}
