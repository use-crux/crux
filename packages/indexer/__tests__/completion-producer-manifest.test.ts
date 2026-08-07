import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { completionSiteManifest } from "../src/indexer/semantic/backends/tsgo/direct-projectors/completion-sites";
import { nativeDirectPrimitiveManifest } from "../src/indexer/semantic/backends/tsgo/direct-projectors/manifest";

interface ProducerIdentity {
  readonly matchKind: "call" | "new";
  readonly name: string;
  readonly importFrom: readonly string[];
}

const producerIdentities = JSON.parse(
  readFileSync(
    new URL(
      "../../../crates/primitives/src/producer_identities.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as readonly ProducerIdentity[];

describe("completion producer identity manifest", () => {
  it("pins the complete compiler-owned producer boundary", () => {
    expect(producerIdentities).toEqual([
      producer("call", "agent", ["@use-crux/core/agent"]),
      producer("call", "cascade", ["@use-crux/core/routing"]),
      producer("call", "context", ["@use-crux/core"]),
      producer("call", "convexAgent", [
        "@use-crux/convex",
        "@use-crux/convex/agent",
      ]),
      producer("call", "createTool", ["@use-crux/convex/agent"]),
      producer("call", "fallback", [
        "@use-crux/core",
        "@use-crux/core/routing",
      ]),
      producer("call", "getSession", [
        "@use-crux/core",
        "@use-crux/core/session",
      ]),
      producer("call", "managedTransportBinding", [
        "@use-crux/core",
        "@use-crux/core/signal/provider",
      ]),
      producer("call", "mcp", ["@use-crux/mcp"]),
      producer("call", "prompt", ["@use-crux/core"]),
      producer("call", "retry", ["@use-crux/core/routing"]),
      producer("call", "router", ["@use-crux/core/routing"]),
      producer("call", "session", ["@use-crux/core", "@use-crux/core/session"]),
      producer("call", "signal", ["@use-crux/core", "@use-crux/core/signal"]),
      producer("call", "signalProvider", [
        "@use-crux/core",
        "@use-crux/core/signal/provider",
      ]),
      producer("call", "split", ["@use-crux/core/routing"]),
      producer("call", "thread", ["@use-crux/core/thread"]),
      producer("call", "tool", ["@use-crux/core", "@use-crux/core/tools"]),
      producer("call", "webhook", [
        "@use-crux/core",
        "@use-crux/core/signal/transport",
      ]),
      producer("call", "polling", [
        "@use-crux/core",
        "@use-crux/core/signal/transport",
      ]),
      producer("call", "stream", [
        "@use-crux/core",
        "@use-crux/core/signal/transport",
      ]),
      producer("new", "Agent", ["@use-crux/convex/agent"]),
    ]);
  });

  it("admits every completion-site call through the same identity manifest", () => {
    const admittedCalls = new Set(
      producerIdentities
        .filter((identity) => identity.matchKind === "call")
        .map((identity) => identity.name),
    );
    const siteCalls = completionSiteManifest(
      nativeDirectPrimitiveManifest,
    ).flatMap((site) => site.callNames);

    expect(siteCalls.every((callName) => admittedCalls.has(callName))).toBe(
      true,
    );
  });

  it("references public package barrels that export every declared producer", () => {
    for (const identity of producerIdentities) {
      for (const moduleSpecifier of identity.importFrom) {
        const module = publicModules[moduleSpecifier];
        expect(module, moduleSpecifier).toBeDefined();
        expect(publicPackageExports(moduleSpecifier)).toContain(
          module?.exportKey,
        );
        expect(exportedNames(module?.sourceFile ?? "")).toContain(
          identity.name,
        );
      }
    }
  });
});

function producer(
  matchKind: ProducerIdentity["matchKind"],
  name: string,
  importFrom: readonly string[],
): ProducerIdentity {
  return { matchKind, name, importFrom };
}

const publicModules: Readonly<
  Record<
    string,
    {
      readonly packageDir: string;
      readonly exportKey: string;
      readonly sourceFile: string;
    }
  >
> = {
  "@use-crux/core": moduleEntry("core", ".", "src/index.ts"),
  "@use-crux/core/agent": moduleEntry("core", "./agent", "src/agent/index.ts"),
  "@use-crux/core/routing": moduleEntry(
    "core",
    "./routing",
    "src/routing/index.ts",
  ),
  "@use-crux/core/session": moduleEntry(
    "core",
    "./session",
    "src/session/index.ts",
  ),
  "@use-crux/core/signal": moduleEntry(
    "core",
    "./signal",
    "src/signal/index.ts",
  ),
  "@use-crux/core/signal/provider": moduleEntry(
    "core",
    "./signal/provider",
    "src/signal/provider/index.ts",
  ),
  "@use-crux/core/signal/transport": moduleEntry(
    "core",
    "./signal/transport",
    "src/signal/transport/index.ts",
  ),
  "@use-crux/core/thread": moduleEntry(
    "core",
    "./thread",
    "src/thread/index.ts",
  ),
  "@use-crux/core/tools": moduleEntry("core", "./tools", "src/tools.ts"),
  "@use-crux/convex": moduleEntry("convex", ".", "src/index.ts"),
  "@use-crux/convex/agent": moduleEntry("convex", "./agent", "src/agent.ts"),
  "@use-crux/mcp": moduleEntry("mcp", ".", "src/index.ts"),
};

function moduleEntry(packageDir: string, exportKey: string, source: string) {
  return {
    packageDir,
    exportKey,
    sourceFile: join(process.cwd(), "..", packageDir, source),
  };
}

function publicPackageExports(moduleSpecifier: string): readonly string[] {
  const entry = publicModules[moduleSpecifier];
  if (!entry) return [];
  const manifest = JSON.parse(
    readFileSync(
      join(process.cwd(), "..", entry.packageDir, "package.json"),
      "utf8",
    ),
  ) as { readonly exports?: Readonly<Record<string, unknown>> };
  return Object.keys(manifest.exports ?? {});
}

function exportedNames(sourceFile: string): readonly string[] {
  const source = readFileSync(sourceFile, "utf8");
  const parsed = ts.createSourceFile(
    sourceFile,
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return parsed.statements.flatMap((statement) => {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.map(
        (element) => element.name.text,
      );
    }
    if (!hasExportModifier(statement)) return [];
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      return [statement.name.text];
    }
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [declaration.name.text] : [],
      );
    }
    return [];
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts
      .getModifiers(node as ts.HasModifiers)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}
