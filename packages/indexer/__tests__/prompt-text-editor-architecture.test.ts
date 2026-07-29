import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("PromptText editor architecture", () => {
  it("keeps CommonMark parsing in the Rust static compiler", () => {
    const dependencyFiles = collectFiles(
      repoRoot,
      (path) =>
        path.endsWith("Cargo.toml") ||
        path.endsWith("go.mod") ||
        path.endsWith("package.json"),
    );
    const owners = dependencyFiles
      .filter((path) => readFileSync(path, "utf8").includes("pulldown-cmark"))
      .map((path) => relative(repoRoot, path));

    expect(owners).toEqual(["Cargo.toml", "crates/static-compiler/Cargo.toml"]);
    expect(
      forbiddenParserReferences([
        "packages/local/internal/lsp",
        "packages/vscode/src",
        "packages/devtools/ui/src",
      ]),
    ).toEqual([]);
  });

  it("keeps VS Code on mapped decorations and the native TypeScript service", () => {
    const manifest = requiredRecord(
      JSON.parse(
        readFileSync(join(repoRoot, "packages/vscode/package.json"), "utf8"),
      ),
      "VS Code manifest",
    );
    const contributes = requiredRecord(manifest.contributes, "contributes");
    expect(contributes).not.toHaveProperty("grammars");
    expect(contributes).not.toHaveProperty("semanticTokenScopes");

    const source = productionSource("packages/vscode/src");
    expect(source).not.toContain("registerDocumentSemanticTokensProvider");
    expect(source).not.toContain("registerDocumentRangeSemanticTokensProvider");
    expect(source).not.toMatch(/from\s+["']typescript["']/u);

    const dependencies = requiredRecord(manifest.dependencies, "dependencies");
    expect(dependencies).not.toHaveProperty("typescript");
  });

  it("routes every Go feature through the shared transient coordinator", () => {
    const source = productionSource("packages/local/internal/lsp/prompttext");

    expect(source).not.toContain(".PromptText(");
    expect(source).not.toContain("pulldown");
    expect(source).not.toContain("goldmark");
    expect(source).not.toContain("blackfriday");
    expect(source).not.toContain("gomarkdown");
    expect(source).toContain("c.coordinator.Analyze(");
  });

  it("keeps transient analysis out of persistent and public index models", () => {
    const source = [
      productionSource("packages/local/internal/projectindex/cache"),
      productionSource("packages/local/internal/store"),
      productionSource("packages/local/internal/api"),
    ].join("\n");

    expect(source).not.toContain("internal/lsp/transient");
    expect(source).not.toContain("PromptTextQueryResponse");
    expect(source).not.toContain("PromptTextInterpolationBarrier");
    expect(source).not.toContain("PromptTextPreviewSegment");
  });
});

function forbiddenParserReferences(roots: readonly string[]): string[] {
  const vocabulary = [
    "markdown-it",
    "remark-parse",
    "pulldown-cmark",
    "goldmark",
    "blackfriday",
    "gomarkdown",
  ];
  return roots.flatMap((root) =>
    collectFiles(join(repoRoot, root), isProductionSource)
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        return vocabulary.some((name) => source.includes(name));
      })
      .map((path) => relative(repoRoot, path)),
  );
}

function productionSource(root: string): string {
  return collectFiles(join(repoRoot, root), isProductionSource)
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
}

function isProductionSource(path: string): boolean {
  return (
    (path.endsWith(".go") || path.endsWith(".ts") || path.endsWith(".tsx")) &&
    !path.endsWith("_test.go") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".test.tsx")
  );
}

function collectFiles(
  root: string,
  include: (path: string) => boolean,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    if (
      entry === ".git" ||
      entry === "node_modules" ||
      entry === "target" ||
      entry === "dist"
    ) {
      continue;
    }
    const path = join(root, entry);
    if (statSync(path).isDirectory())
      files.push(...collectFiles(path, include));
    else if (include(path)) files.push(path);
  }
  return files.sort();
}

function requiredRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
