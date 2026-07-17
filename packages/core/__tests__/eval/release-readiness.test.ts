import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("Eval release readiness", () => {
  it("publishes Eval guides and reference pages in the docs navigation", async () => {
    const guideMeta = await readJson("apps/docs/content/docs/guides/meta.json");
    const coreMeta = await readJson(
      "apps/docs/content/docs/reference/crux-core/meta.json",
    );

    expect(guideMeta.pages).toContain("evals");
    expect(guideMeta.pages).not.toContain("quality");
    expect(coreMeta.pages).toContain("eval");
    expect(coreMeta.pages).not.toContain("quality");

    await expect(
      readRepoFile("apps/docs/content/docs/guides/evals/index.mdx"),
    ).resolves.toContain("# Evals");
    await expect(
      readRepoFile("apps/docs/content/docs/reference/crux-core/eval.mdx"),
    ).resolves.toContain("@use-crux/core/eval");
  });

  it("contains no removed Quality imports, commands, config, or doc links", async () => {
    const files = await publicDocumentationFiles();
    const forbidden = [
      /@use-crux\/core\/quality/u,
      /\bcrux quality\b/u,
      /\/guides\/quality(?:\/|\b)/u,
      /\/reference\/crux-core\/quality\b/u,
      /\bQualityConfig\b/u,
      /\bquality\.defaults\b/u,
      /\bcassettes?\b/iu,
      /\breplay-strict\b/iu,
      /\brecord-new\b/iu,
      /\bcrux eval (?:progress|cell-evidence|promote|mcp|init|import-traces)\b/u,
      /@use-crux\/core\/eval[\s\S]{0,200}\b(?:quality|suite|target|cassette)\b/u,
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readRepoFile(file);
      if (forbidden.some((pattern) => pattern.test(source)))
        violations.push(file);
    }

    expect(violations).toEqual([]);
  });

  it("stages the public Eval and feedback exports plus real Cloudflare conformance", async () => {
    const core = await readPackage("packages/core/package.json");
    const ai = await readPackage("packages/ai/package.json");
    const cloudflare = await readPackage("packages/cloudflare/package.json");

    expect(core.exports).toHaveProperty("./eval");
    expect(core.exports).toHaveProperty("./eval/node");
    expect(core.exports).toHaveProperty("./feedback");
    expect(core.exports).not.toHaveProperty("./quality");
    expect(ai.exports).toHaveProperty("./feedback");
    expect(cloudflare.scripts?.["test:workerd"]).toBe(
      "vitest run --config vitest.workerd.config.ts",
    );
    await expect(
      readRepoFile("packages/core/__tests__/eval/compile-perf.test.ts"),
    ).resolves.toContain("extendedDiagnostics");
  });

  it("keeps CLI help and the product-model feedback seam aligned", async () => {
    const cliHelpTest = await readRepoFile(
      "packages/local/internal/commands/evalcmd/help_test.go",
    );
    for (const token of [
      '"run"',
      '"list"',
      '"show"',
      '"diff"',
      '"baseline"',
      '"--offline"',
      '"--plan"',
      '"--fresh"',
      '"--max-cost"',
    ]) {
      expect(cliHelpTest).toContain(token);
    }

    const productModel = await readRepoFile(
      "docs/plans/quality-evals-product-model.html",
    );
    expect(productModel).toContain("@use-crux/ai/feedback");
    expect(productModel).not.toMatch(
      /@use-crux\/core\/feedback[\s\S]{0,400}feedback<\/span>\(message,/u,
    );
  });

  it("documents the five concepts and the no-network boundary", async () => {
    const guide = await readRepoFile(
      "apps/docs/content/docs/guides/evals/index.mdx",
    );
    for (const concept of ["Eval", "Case", "Variant", "Eval run", "Baseline"])
      expect(guide).toContain(`**${concept}**`);
    expect(guide).toContain("--offline");
    expect(guide).toContain("performs no network or external work");
  });
});

interface PackageManifest {
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly scripts?: Readonly<Record<string, string>>;
}

async function readPackage(path: string): Promise<PackageManifest> {
  return JSON.parse(await readRepoFile(path)) as PackageManifest;
}

async function readJson(path: string): Promise<{ pages: readonly string[] }> {
  return JSON.parse(await readRepoFile(path)) as { pages: readonly string[] };
}

function readRepoFile(path: string): Promise<string> {
  return readFile(resolve(repoRoot, path), "utf8");
}

async function publicDocumentationFiles(): Promise<string[]> {
  const roots = ["README.md", "apps/docs/content", "examples"];
  const packageEntries = await readdir(resolve(repoRoot, "packages"));
  for (const entry of packageEntries) {
    const readme = `packages/${entry}/README.md`;
    try {
      if ((await stat(resolve(repoRoot, readme))).isFile()) roots.push(readme);
    } catch {
      // Package has no published README.
    }
  }
  return (await Promise.all(roots.map(documentationFiles))).flat().sort();
}

async function documentationFiles(path: string): Promise<string[]> {
  const absolute = resolve(repoRoot, path);
  if ((await stat(absolute)).isFile()) {
    return /\.(?:html|json|md|mdx|ts)$/u.test(path) ? [path] : [];
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.name !== "node_modules" && !entry.name.startsWith("."),
        )
        .map((entry) => documentationFiles(`${path}/${entry.name}`)),
    )
  ).flat();
}
