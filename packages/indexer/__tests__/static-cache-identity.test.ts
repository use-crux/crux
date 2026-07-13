import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProjectDefinitionKind } from "@use-crux/core/project-index";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readStaticIndexRuntimeSharedFixture } from "../src/contracts/fixtures";
import { facts, type IndexerExtension } from "../src/indexer/extensions";
import {
  SEMANTIC_FACTS_CACHE_EPOCH,
  STATIC_PARSE_CACHE_EPOCH,
} from "../src/indexer/cache-identity";
import { staticParseCacheManifestStatus } from "../src/indexer/static/extraction/cache";
import { createStaticExtraction } from "../src/indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

const roots: string[] = [];
const testWorkspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(testWorkspaceRoot, ".tmp-static-cache-identity-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("static cache identity", () => {
  it("pins the TypeScript static parse cache namespace to the shared Static Index fixture", () => {
    const identity = readStaticIndexRuntimeSharedFixture(
      "static-index-cache-identity",
    );

    expect(STATIC_PARSE_CACHE_EPOCH).toBe(identity.staticParseCacheEpoch);
    expect(STATIC_PARSE_CACHE_EPOCH).toBe("static-parse-v61");
  });

  it("takes the pre-launch semantic facts cache migration epoch", () => {
    expect(SEMANTIC_FACTS_CACHE_EPOCH).toBe("semantic-facts-v27");
  });

  it("projects static host manifest facets into extraction identity", () => {
    const base = createStaticExtraction({
      root: "/fixture",
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
      extensions: [workflowExtension()],
    });
    const changedPattern = createStaticExtraction({
      root: "/fixture",
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
      extensions: [workflowExtension({ callName: "defineFlow" })],
    });
    const changedRelation = createStaticExtraction({
      root: "/fixture",
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
      extensions: [
        workflowExtension({ relationType: "@acme/workflows/starts_tool" }),
      ],
    });

    expect(
      namedDigestDependency(
        base.identity.cacheInputs,
        "native-primitive-manifest",
        "crux-static-index-host",
      ),
    ).toEqual(expect.any(String));
    expect(
      namedDigestDependency(
        base.identity.cacheInputs,
        "static-evidence-manifest",
        "runtime-static-interests",
      ),
    ).toEqual(expect.any(String));
    expect(
      namedDigestDependency(
        base.identity.cacheInputs,
        "extension-manifest",
        "@acme/workflows",
      ),
    ).not.toBe(
      namedDigestDependency(
        changedPattern.identity.cacheInputs,
        "extension-manifest",
        "@acme/workflows",
      ),
    );
    expect(
      namedDigestDependency(
        base.identity.cacheInputs,
        "relation-policy",
        "runtime-relation-specs",
      ),
    ).not.toBe(
      namedDigestDependency(
        changedRelation.identity.cacheInputs,
        "relation-policy",
        "runtime-relation-specs",
      ),
    );
  });

  it("keeps manifest cache inputs stable when locale collation changes", () => {
    const extension = workflowExtension({
      relationType: "@acme/workflows/starts_tool",
    });
    const base = createStaticExtraction({
      root: "/fixture",
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
      extensions: [extension],
    }).identity.cacheInputs;
    const localeCompare = String.prototype.localeCompare;
    const spy = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(function (
        this: string,
        compareString: string,
        locales?: Intl.LocalesArgument,
        options?: Intl.CollatorOptions,
      ): number {
        return localeCompare.call(compareString, this, locales, options);
      });

    try {
      const underDifferentCollation = createStaticExtraction({
        root: "/fixture",
        syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
        cache: "none",
        extensions: [extension],
      }).identity.cacheInputs;
      expect(underDifferentCollation).toEqual(base);
    } finally {
      spy.mockRestore();
    }
  });

  it("invalidates warm native cache status when static compiler manifest identity changes", async () => {
    const root = await fixtureRoot();
    await mkdir(join(root, "src"), { recursive: true });
    const file = join(root, "src/workflow.ts");
    await writeFile(
      file,
      [
        "import { defineWorkflow } from '@acme/workflows'",
        "",
        "export const workflow = defineWorkflow({ id: 'release' })",
      ].join("\n"),
    );

    const base = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      extensions: [workflowExtension()],
    });
    await base.extractFile(file);

    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: base.identity.cacheInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [file], cacheMisses: [] });

    const changedPattern = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      extensions: [workflowExtension({ callName: "defineFlow" })],
    });
    const changedRelation = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      extensions: [
        workflowExtension({ relationType: "@acme/workflows/starts_tool" }),
      ],
    });
    const changedPrimitiveInputs = base.identity.cacheInputs.map(
      (dependency) =>
        dependency.kind === "native-primitive-manifest"
          ? { ...dependency, digest: `${dependency.digest}.changed` }
          : dependency,
    );

    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: changedPattern.identity.cacheInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });
    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: changedRelation.identity.cacheInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });
    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: changedPrimitiveInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });
  });

  it("does not load a pre-media static cache namespace", async () => {
    const root = await fixtureRoot();
    const file = join(root, "media.ts");
    await writeFile(
      file,
      "export const cover = generateImage({ prompt: 'private' })",
    );
    const extraction = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    });
    await extraction.extractFile(file);
    const cacheRoot = join(root, ".crux", "cache", "index");
    await rename(
      join(cacheRoot, STATIC_PARSE_CACHE_EPOCH),
      join(cacheRoot, "static-parse-v60"),
    );

    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: extraction.identity.cacheInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });
  });
});

function workflowExtension(
  input: {
    readonly callName?: string;
    readonly relationType?: string;
  } = {},
): IndexerExtension {
  const callName = input.callName ?? "defineWorkflow";
  return {
    name: "@acme/workflows",
    version: "1",
    relations: input.relationType
      ? [
          {
            type: input.relationType,
            fromKinds: ["workflow"],
            toKinds: ["tool"],
            presentation: "edge",
            runtimeJoin: false,
          },
        ]
      : undefined,
    extractors: [
      {
        name: "workflow.define",
        patterns: [{ kind: "call", name: callName }],
        extract: (ctx) =>
          facts({
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: `@acme.workflow:${ctx.config?.string("id") ?? ctx.source.localName}`,
                kind: "workflow" as ProjectDefinitionKind,
                name: ctx.source.localName,
              }),
            ],
          }),
      },
    ],
  };
}

function namedDigestDependency(
  dependencies: readonly unknown[],
  kind: string,
  name: string,
): string {
  const dependency = dependencies.find(
    (item) =>
      !!item &&
      typeof item === "object" &&
      "kind" in item &&
      "name" in item &&
      item.kind === kind &&
      item.name === name,
  );
  expect(dependency).toEqual(
    expect.objectContaining({ kind, name, digest: expect.any(String) }),
  );
  return (dependency as { readonly digest: string }).digest;
}
