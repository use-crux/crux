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
 * checks. These tests keep the beta docs aligned with the executable gate
 * instead of letting readiness notes drift from CI.
 */
async function readRepoDoc(path: string): Promise<string> {
  try {
    return await readFile(join(repoRoot, path), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Missing required native AST readiness artifact: ${path}. If this passes locally but fails in CI, verify the file is tracked and included with the readiness test.`,
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

describe("native AST beta readiness docs", () => {
  it("documents the beta gate, release checks, extension host, and default-readiness criteria", async () => {
    const [
      readiness,
      publishing,
      indexerReference,
      configReference,
      projectIndexReference,
    ] = await Promise.all([
      readRepoDoc("docs/NATIVE_AST_BETA_READINESS.md"),
      readRepoDoc("docs/PUBLISHING.md"),
      readRepoDoc("apps/docs/content/docs/reference/indexer.mdx"),
      readRepoDoc("apps/docs/content/docs/reference/crux-core/config.mdx"),
      readRepoDoc(
        "apps/docs/content/docs/reference/crux-core/project-index.mdx",
      ),
    ]);

    expect(readiness).toContain("pnpm test:native-ast-parity");
    expect(readiness).toContain("rust-first-party-static-golden.test.ts");
    expect(readiness).toContain("rust-first-party-static-golden.json");
    expect(readiness).toContain("Rust-owned descriptor fixture");
    expect(readiness).toContain("First-party extractor families are Rust-only in the binary");
    expect(readiness).toContain("TypeScript extension host");
    expect(readiness).toContain("Default-readiness checklist");

    expect(publishing).toContain("Native AST beta parity");
    expect(publishing).toContain("pnpm test:native-ast-parity");
    expect(publishing).toContain("make local");

    for (const source of [
      indexerReference,
      configReference,
      projectIndexReference,
    ]) {
      expect(source).toContain("experimental.indexer.nativeAst");
      expect(source).toContain("Rust/Oxc");
      expect(source).toContain("TypeScript extension");
    }

    expect(indexerReference).toContain("Node can still start");
    expect(configReference).toContain("native AST beta gate");
    expect(projectIndexReference).toContain(
      "fallback or Node-start diagnostics",
    );
  });

  it("pins the CI parity gate and native AST benchmark entrypoint", async () => {
    const [workflow, packageJson, benchmarkScript, readiness] =
      await Promise.all([
        readRepoDoc(".github/workflows/ci.yml"),
        readRepoJson<RootPackageJson>("package.json"),
        readRepoDoc("scripts/native-ast-benchmark.mjs"),
        readRepoDoc("docs/NATIVE_AST_BETA_READINESS.md"),
      ]);

    expect(workflow).toMatch(
      /name: Native AST parity gate\s+run: pnpm test:native-ast-parity/,
    );
    expect(packageJson.scripts?.["test:native-ast-parity"]).toBe(
      "node ./scripts/native-ast-parity-gate.mjs",
    );
    expect(packageJson.scripts?.["benchmark:native-ast"]).toBe(
      "node ./scripts/native-ast-benchmark.mjs",
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
    expect(readiness).toContain("pnpm benchmark:native-ast");
    expect(readiness).toContain("Future native direct-projector expansion");
    expect(readiness).toContain("measured user-visible bottleneck");
    expect(readiness).toContain("exact normalized parity fixture");
    expect(readiness).toContain("complete fallback for unsupported syntax");
    expect(readiness).toContain("Phase 9 one-shot baselines");
  });
});
