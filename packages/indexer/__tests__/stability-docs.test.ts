import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SEMANTIC_FACTS_CACHE_EPOCH,
  STATIC_PARSE_CACHE_EPOCH,
} from "../src/indexer/cache-identity";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("stable beta docs", () => {
  it("keeps cache migration epochs and terminology aligned with code", () => {
    const docs = [
      readRepoFile("packages/indexer/CONTEXT.md"),
      readRepoFile(
        "packages/indexer/docs/adr/0011-semantic-evidence-native-backends.md",
      ),
      readRepoFile("docs/NATIVE_AST_BETA_READINESS.md"),
      readRepoFile("apps/docs/content/docs/reference/indexer.mdx"),
    ].join("\n");

    expect(docs).toContain(STATIC_PARSE_CACHE_EPOCH);
    expect(docs).toContain(SEMANTIC_FACTS_CACHE_EPOCH);
    expect(docs).toContain("epoch-36");
    expect(docs).not.toMatch(/static-parse-v(39|45|51|52)\b/);
    expect(docs).not.toMatch(/semantic-facts-v(15|17|20)\b/);
    expect(docs).not.toContain(
      "packages/local/internal/devtools/index_cache_identity.go",
    );
    expect(docs).not.toContain(".crux/cache/index/index.json");
    expect(docs).not.toContain("Legacy Crux Indexer");
    expect(docs).not.toContain('"Index" and "Crux Indexer" are legacy');
  });

  it("does not point package docs at the removed incremental planner execution plan", () => {
    for (const path of [
      "packages/indexer/README.md",
      "packages/indexer/ARCHITECTURE.md",
    ]) {
      const source = readRepoFile(path);
      expect(source).not.toContain(
        "docs/incremental-planner-execution-plan.md",
      );
    }

    expect(
      existsSync(
        join(
          repoRoot,
          "packages/indexer/docs/adr/0001-incremental-planner-before-partial-execution.md",
        ),
      ),
    ).toBe(true);
  });

  it("documents semantic native config separately from Static Index syntax config", () => {
    const configReference = readRepoFile(
      "apps/docs/content/docs/reference/crux-core/config.mdx",
    );
    const indexerReference = readRepoFile(
      "apps/docs/content/docs/reference/indexer.mdx",
    );

    expect(configReference).toContain(
      "`experimental.indexer.native` and `experimental.indexer.nativeAst` are independent",
    );
    expect(configReference).toContain("`native` controls semantic enrichment");
    expect(configReference).toContain(
      "`nativeAst` controls the first static AST/source pass",
    );
    expect(indexerReference).toMatch(
      /This flag does not select the native\s+semantic backend/,
    );
    expect(indexerReference).toContain("config/static-plan inspection");
  });

  it("documents the complete routing Project Index and catalog contract", () => {
    const indexerReference = readRepoFile(
      "apps/docs/content/docs/reference/indexer.mdx",
    );
    const projectIndexReference = readRepoFile(
      "apps/docs/content/docs/reference/crux-core/project-index.mdx",
    );
    const indexerContext = readRepoFile("packages/indexer/CONTEXT.md");
    const coreArchitecture = readRepoFile("packages/core/ARCHITECTURE.md");
    const published = `${indexerReference}\n${projectIndexReference}`;

    for (const kind of [
      "routing.router",
      "routing.router.route",
      "routing.split",
      "routing.split.route",
      "routing.retry",
      "routing.retry.target",
      "routing.cascade",
      "routing.cascade.tier",
      "routing.fallback",
      "routing.fallback.option",
    ]) {
      expect(published).toContain(`\`${kind}\``);
    }

    for (const relation of [
      "router.includes_route",
      "split.includes_route",
      "retry.uses_target",
      "cascade.includes_tier",
      "fallback.includes_option",
    ]) {
      expect(published).toContain(`\`${relation}\``);
    }

    expect(projectIndexReference).toContain(
      "router `classify` callback or split `seed` callback annotated with `RouteArgs`",
    );
    expect(projectIndexReference).toContain("`routingContextType`");
    expect(projectIndexReference).toContain("`routingContextRequired`");
    expect(projectIndexReference).toContain(
      "route call-profile objects can add a JSON-safe child `profile`",
    );
    expect(published).toContain("`metadata.indexPresentation`");
    expect(projectIndexReference).toContain(
      "Core owns the JSON-safe Project Index contract",
    );
    expect(projectIndexReference).toContain(
      "Go service preserves and serves the merged read model",
    );

    expect(indexerContext).toContain(
      "`router`/`split`/`retry`/`cascade`/`fallback` parent and child definitions",
    );
    expect(coreArchitecture).toContain("`routingContextType`");
    expect(coreArchitecture).toContain("`routingContextRequired`");
    expect(coreArchitecture).toContain("`profile`");
    expect(coreArchitecture).not.toContain("fallback-loop");
    for (const file of [
      "receipt.ts",
      "observability.ts",
      "first-token.ts",
      "resolve-fallback.ts",
      "resolve-retry.ts",
      "resolve-split.ts",
    ]) {
      expect(coreArchitecture).toContain(file);
    }
  });

  it("documents the stable-beta lint maturity policy", () => {
    const lintReference = readRepoFile(
      "apps/docs/content/docs/reference/crux-core/lint.mdx",
    );
    const lintGuide = readRepoFile(
      "apps/docs/content/docs/guides/project-health/lint.mdx",
    );

    expect(lintReference).toContain("Stable-beta rules");
    expect(lintReference).toContain("Preview rules");
    expect(lintReference).toContain("runtime.non_serializable_payload");
    expect(lintGuide).toContain(
      "Stable-beta rules are the default quality-gate set",
    );
  });
});
