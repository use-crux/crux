import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

/**
 * Reads a repository text artifact for release-readiness contract
 * checks. These tests keep the readiness docs aligned with the executable gate
 * instead of letting readiness notes drift from CI.
 */
async function readRepoDoc(path: string): Promise<string> {
  try {
    return await readFile(join(repoRoot, path), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Missing required Static Index readiness artifact: ${path}. If this passes locally but fails in CI, verify the file is tracked and included with the readiness test.`,
      );
    }
    throw error;
  }
}

/**
 * Reads a JSON artifact and preserves the expected shape for command contract
 * assertions.
 */
async function readRepoJson<T>(path: string): Promise<T> {
  return JSON.parse(await readRepoDoc(path)) as T;
}

type RootPackageJson = {
  readonly scripts?: Readonly<Record<string, string>>;
};

describe("Static Index readiness docs", () => {
  it("documents the release gate, required compiler, and extension host", async () => {
    const [
      readiness,
      publishing,
      indexerReference,
      configReference,
      projectIndexReference,
    ] = await Promise.all([
      readRepoDoc("docs/STATIC_INDEX_READINESS.md"),
      readRepoDoc("docs/PUBLISHING.md"),
      readRepoDoc("apps/docs/content/docs/reference/indexer.mdx"),
      readRepoDoc("apps/docs/content/docs/reference/crux-core/config.mdx"),
      readRepoDoc(
        "apps/docs/content/docs/reference/crux-core/project-index.mdx",
      ),
    ]);

    expect(readiness).toContain("pnpm test:static-index-parity");
    expect(readiness).toContain("rust-first-party-static-golden.test.ts");
    expect(readiness).toContain("rust-first-party-static-golden.json");
    expect(readiness).toContain("Rust-owned descriptor fixture");
    expect(readiness).toContain("First-party extractor families are Rust-only in the binary");
    expect(readiness).toContain("TypeScript extension host");
    expect(readiness).toContain("A missing or incompatible worker is a setup failure");

    expect(publishing).toContain("Static Index parity");
    expect(publishing).toContain("pnpm test:static-index-parity");
    expect(publishing).toContain("make local");

    for (const source of [
      indexerReference,
      configReference,
      projectIndexReference,
    ]) {
      expect(source).toContain("Rust/Oxc");
      expect(source).toContain("TypeScript extension");
      expect(source).not.toContain("experimental.indexer.nativeAst");
    }

    expect(indexerReference).toMatch(/A missing worker\s+is a setup error/);
    expect(configReference).toMatch(/Static Index has no\s+frontend selector/);
    expect(projectIndexReference).toMatch(/Static Index always uses/);
  });

  it("pins the CI parity gate and Static Index benchmark entrypoint", async () => {
    const [workflow, packageJson, benchmarkScript, readiness] =
      await Promise.all([
        readRepoDoc(".github/workflows/ci.yml"),
        readRepoJson<RootPackageJson>("package.json"),
        readRepoDoc("scripts/static-index-benchmark.mjs"),
        readRepoDoc("docs/STATIC_INDEX_READINESS.md"),
      ]);

    expect(workflow).toMatch(
      /name: Static Index parity gate\s+run: pnpm test:static-index-parity/,
    );
    expect(packageJson.scripts?.["test:static-index-parity"]).toBe(
      "node ./scripts/static-index-parity-gate.mjs",
    );
    expect(packageJson.scripts?.["benchmark:static-index"]).toBe(
      "node ./scripts/static-index-benchmark.mjs",
    );
    expect(benchmarkScript).toContain("CRUX_INDEXER_BENCH_ROOT");
    expect(benchmarkScript).not.toContain("CRUX_INDEXER_BENCH_NATIVE_AST");
    expect(benchmarkScript).not.toContain("js-cold");
    expect(benchmarkScript).toContain("production-cold");
    expect(benchmarkScript).toContain("production-warm");
    expect(benchmarkScript).toContain(
      "BenchmarkWorker(IndexProjectAstPatch|ReindexProjectGraphPipeline|ProductionWatchLeafPath)$",
    );
    expect(benchmarkScript).toContain("CRUX_INDEXER_BENCH_CLEAR_CACHE");
    expect(benchmarkScript).toContain("CRUX_INDEXER_BENCH_TIER_A_MS");
    expect(benchmarkScript).toContain("go test");
    expect(readiness).toContain("pnpm benchmark:static-index");
    expect(readiness).toContain("Phase 9 one-shot baselines");
  });
});
