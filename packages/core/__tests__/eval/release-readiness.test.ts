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
      /\.crux\/quality\b/iu,
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

  it("keeps public configuration and examples free of the removed Quality model", async () => {
    const files = [
      "packages/core/src/runtime/config.ts",
      "packages/core/src/runtime/config-types.ts",
      "packages/core/__type_tests__/config-contract.ts",
      "packages/core/CLAUDE.md",
    ];
    const violations: string[] = [];

    for (const file of files) {
      const source = await readRepoFile(file);
      if (
        /\bquality\s*:/iu.test(source) ||
        /\breplay\s*:\s*["']record-new["']/iu.test(source) ||
        /Quality system/iu.test(source)
      ) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not retain parallel pre-Eval authoring, storage, or wire models", async () => {
    const promptTypes = await readRepoFile(
      "packages/core/src/prompt/prompt-types.ts",
    );
    expect(promptTypes).not.toMatch(/\btests\??\s*:/u);

    const exactLegacyFiles = [
      "packages/local/internal/store/evals.go",
      "packages/local/tapes/cassettes.tape",
      "packages/local/tapes/datasets.tape",
      "packages/local/tapes/experiments.tape",
    ];
    for (const file of exactLegacyFiles) {
      await expect(fileExists(file)).resolves.toBe(false);
    }

    const activeSources = await Promise.all(
      [
        "packages/core/src",
        "packages/indexer/src",
        "packages/local/internal",
        "packages/devtools/ui/src",
        "scripts/generate-observability-coverage-fixture.mjs",
      ].map(documentationFiles),
    );
    const forbidden = [
      /\bRagEvalRun\b/u,
      /\bquality:event\b/u,
      /\bquality-owned\b/u,
      /["']quality-join["']/u,
      /\bIndexQuality\b/u,
      /\bLegacyFlow(?:Run|s)\b/u,
      /\bCrux(?:Diff|Run)ComparisonReportPreview\b/u,
      /\bCruxBaselinePromotionPreview\b/u,
      /["']comparison\.(?:report|baseline|candidate)["']/u,
      /["']baseline\.promotion["']/u,
      /\beval\.suite\b/u,
      /\b(?:scorerNames|gateKeys|variantNames)\b/u,
    ];
    const violations: string[] = [];
    for (const file of activeSources.flat()) {
      const source = await readRepoFile(file);
      if (forbidden.some((pattern) => pattern.test(source)))
        violations.push(file);
    }
    expect(violations).toEqual([]);
  }, 30_000);

  it("keeps Devtools source and the embedded UI free of Quality Workbench names", async () => {
    const files = (
      await Promise.all(
        [
          "packages/devtools/ui/src",
          "packages/local/internal/assets/ui-embed",
        ].map(devtoolsArtifactFiles),
      )
    ).flat();
    const sharedForbidden = [
      /Quality Workbench/iu,
      /\bQW_NAV\b/u,
      /--qw-/u,
      /\bqw:/u,
    ];
    const legacyQwIdentifier = /\bQw[A-Z][A-Za-z0-9_]*/u;
    const embeddedLegacyQwIdentifier =
      /\bQw(?:Confirm|Menu|Shell|Sidebar|Tooltip)\b/u;
    const violations: string[] = [];

    for (const file of files) {
      const source = await readRepoFile(file);
      const identifierPattern = file.startsWith("packages/devtools/ui/src/")
        ? legacyQwIdentifier
        : embeddedLegacyQwIdentifier;
      if (
        legacyQwIdentifier.test(file) ||
        identifierPattern.test(source) ||
        sharedForbidden.some((pattern) => pattern.test(source))
      )
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
    expect(core.typesVersions?.["*"]).toMatchObject({
      eval: ["src/eval/index.ts"],
      "eval/node": ["src/eval/node.ts"],
      feedback: ["src/feedback/index.ts"],
    });
    expect(ai.exports).toHaveProperty("./feedback");
    expect(cloudflare.homepage).toBe(
      "https://cruxjs.dev/docs/guides/evals/runtime-hosts#cloudflare-workers",
    );
    await expect(
      readRepoFile("scripts/stage-npm-packages.mjs"),
    ).resolves.toContain("@use-crux/cloudflare");
    expect(cloudflare.scripts?.["test:workerd"]).toBe(
      "vitest run --config vitest.workerd.config.ts",
    );
    await expect(
      readRepoFile("packages/core/__tests__/eval/compile-perf.test.ts"),
    ).resolves.toContain("extendedDiagnostics");
  });

  it("keeps CLI help and the feedback guide aligned", async () => {
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

    const feedbackGuide = await readRepoFile(
      "apps/docs/content/docs/guides/evals/feedback-and-review.mdx",
    );
    expect(feedbackGuide).toContain("@use-crux/ai/feedback");
    expect(feedbackGuide).toContain("getOwned");
    expect(feedbackGuide).not.toMatch(
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

  it("records the clean Eval replacement in the pending or generated release", async () => {
    const changesetPath = ".changeset/bright-evals-review.md";
    const packageChangelogs = {
      "@use-crux/core": "packages/core/CHANGELOG.md",
      "@use-crux/local": "packages/local/npm/local/CHANGELOG.md",
      "@use-crux/indexer": "packages/indexer/CHANGELOG.md",
      "@use-crux/ai": "packages/ai/CHANGELOG.md",
      "@use-crux/cloudflare": "packages/cloudflare/CHANGELOG.md",
      "@use-crux/convex": "packages/convex/CHANGELOG.md",
      "@use-crux/devtools": "packages/devtools/CHANGELOG.md",
    } as const;

    if (await fileExists(changesetPath)) {
      const changeset = await readRepoFile(changesetPath);
      for (const packageName of Object.keys(packageChangelogs))
        expect(changeset).toContain(`"${packageName}": minor`);
      return;
    }

    const evalReleaseLead =
      "Replace the pre-release Quality authoring, execution, CLI, storage, and";
    for (const changelogPath of Object.values(packageChangelogs)) {
      const changelog = await readRepoFile(changelogPath);
      const evalRelease =
        changelog
          .split(/^## /mu)
          .find((release) => release.includes(evalReleaseLead)) ?? "";
      const minorChanges =
        evalRelease.split(/^### Minor Changes$/mu)[1]?.split(/^### /mu)[0] ??
        "";
      expect(minorChanges).toContain(evalReleaseLead);
      expect(minorChanges).toContain("Devtools model with Crux Evals V1");
    }
  });
});

interface PackageManifest {
  readonly homepage?: string;
  readonly exports?: Readonly<Record<string, unknown>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly typesVersions?: Readonly<
    Record<string, Readonly<Record<string, readonly string[]>>>
  >;
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

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(resolve(repoRoot, path))).isFile();
  } catch {
    return false;
  }
}

async function publicDocumentationFiles(): Promise<string[]> {
  const roots = ["README.md", "apps/docs/app", "apps/docs/content", "examples"];
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
    return /\.(?:go|html|json|md|mdx|mjs|rs|ts|tsx)$/u.test(path) ? [path] : [];
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

async function devtoolsArtifactFiles(path: string): Promise<string[]> {
  const absolute = resolve(repoRoot, path);
  if ((await stat(absolute)).isFile()) {
    return /\.(?:css|html|js|jsx|ts|tsx)$/u.test(path) ? [path] : [];
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.name !== "node_modules" && !entry.name.startsWith("."),
        )
        .map((entry) => devtoolsArtifactFiles(`${path}/${entry.name}`)),
    )
  ).flat();
}
