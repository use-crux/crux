import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import type {
  IndexDiagnostic,
  ProjectDefinitionKind,
} from "@use-crux/core/project-index";
import { describe, expect, it } from "vitest";
import {
  facts,
  type ExtractedFacts,
  type IndexerExtension,
} from "../indexer/extensions";
import {
  createStaticExtraction,
  type SourceReader,
  type StaticFileExtraction,
} from "../indexer/static/extraction/engine";
import {
  createProvidedStaticSyntaxFrontend,
  createTypeScriptStaticSyntaxFrontend,
  type StaticSourceMatch,
  type StaticSyntaxFileRecord,
} from "../indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../testing/rust-oxc-frontend";
import {
  assertDeterministicExtraction,
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from "../testing";

const rustOxcStatus = rustOxcSyntaxFrontendTestStatus();

describe("static extraction engine", () => {
  it("projects stable compiler and syntax frontend identity", () => {
    const extraction = createStaticExtraction({
      root: "/fixture",
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
    });

    expect(extraction.identity.cacheInputs).toEqual(
      expect.arrayContaining([
        {
          kind: "compiler-profile",
          name: "@use-crux/indexer/crux-core-profile",
          version: "1",
        },
        { kind: "syntax-frontend", name: "typescript", version: ts.version },
      ]),
    );
    expect([...extraction.identity.callNames]).toEqual(
      expect.arrayContaining([...extraction.manifest.callNames]),
    );
  });

  it("runs extension fixtures through the production extraction path", async () => {
    const fixture = defineIndexerExtensionFixture(workflowExtension());

    const out = await extractFixtureSource(
      fixture,
      `export const workflow = defineWorkflow({ id: 'release' })`,
    );

    expect(out.definitions).toEqual([
      expect.objectContaining({
        id: "@acme.workflow:release",
        kind: "workflow",
        name: "release",
      }),
    ]);
    expect(out.facts.definitions).toBe(out.definitions);
    expect(out.trace.cacheInputs).toEqual(
      expect.arrayContaining([
        { kind: "extension", name: "@acme/workflows", version: "1" },
        {
          kind: "syntax-frontend",
          name: out.trace.syntaxFrontend.name,
          version: out.trace.syntaxFrontend.version,
        },
      ]),
    );
    expect(["typescript", "oxc-rust"]).toContain(out.trace.syntaxFrontend.name);
    if (out.trace.syntaxFrontend.name === "typescript") {
      expect(out.trace.syntaxFrontend.version).toBe(ts.version);
    }
    await expect(
      assertDeterministicExtraction(
        fixture,
        `export const workflow = defineWorkflow({ id: 'release' })`,
      ),
    ).resolves.toBeUndefined();
  });

  itWithRustOxc(
    "runs compiler call filters through the native Rust/Oxc syntax frontend",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/workflow.ts";
      const extraction = createStaticExtraction({
        root,
        cache: "none",
        extensions: [workflowExtension()],
        sources: memorySourceReader({
          [file]: [
            "import { defineWorkflow, unrelatedFactory } from '@acme/workflows'",
            "",
            "export const workflow = defineWorkflow({ id: 'release' })",
            "unrelatedFactory({ id: 'ignored' })",
          ].join("\n"),
        }),
        syntaxFrontend: createRustOxcStaticSyntaxFrontend,
      });

      const extracted = await extraction.extractFile(file);

      expect(extracted.definitions).toEqual([
        expect.objectContaining({
          id: "@acme.workflow:release",
          kind: "workflow",
        }),
      ]);
      expect(extraction.identity.cacheInputs).toEqual(
        expect.arrayContaining([
          { kind: "extension", name: "@acme/workflows", version: "1" },
          {
            kind: "syntax-frontend",
            name: "oxc-rust",
            version: "oxc_parser@0.133.0+crux_native_group3.7",
          },
        ]),
      );
    },
    30_000,
  );

  it("projects extension facts from caller-provided syntax records", async () => {
    const root = "/fixture";
    const file = "/fixture/src/workflow.ts";
    const source = [
      "import { defineWorkflow } from '@acme/workflows'",
      "",
      "export const workflow = defineWorkflow({ id: 'release' })",
    ].join("\n");
    const record = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["defineWorkflow"],
    }).parseFile({
      root,
      file,
      source,
    });
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [workflowExtension()],
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records: [record] }),
    });

    const extracted = await extraction.extractFile(file);

    expect(extracted.definitions).toEqual([
      expect.objectContaining({
        id: "@acme.workflow:release",
        kind: "workflow",
      }),
    ]);
    expect(extraction.identity.cacheInputs).toEqual(
      expect.arrayContaining([
        { kind: "syntax-frontend", name: "typescript", version: ts.version },
      ]),
    );
  });

  it("orders tree path projections deterministically when async leaf resolution races", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-static-tree-order-"));
    try {
      const sourceDir = join(root, "src");
      const file = join(sourceDir, "prompts.ts");
      const importedFile = join(sourceDir, "imported.ts");
      const files = {
        [importedFile]: [
          "import { prompt } from '@use-crux/core'",
          "export const importedPrompt = prompt({ id: 'imported' })",
        ].join("\n"),
        [file]: [
          "import { createPrompts, prompt } from '@use-crux/core'",
          "import { importedPrompt } from './imported'",
          "",
          "export const localPrompt = prompt({ id: 'local' })",
          "export const importedTree = createPrompts({ a: importedPrompt })",
          "export const localTree = createPrompts({ z: localPrompt })",
        ].join("\n"),
      };
      await mkdir(sourceDir, { recursive: true });
      await Promise.all(
        Object.entries(files).map(([path, source]) => writeFile(path, source)),
      );
      const extraction = createStaticExtraction({
        root,
        cache: "none",
        sources: delayedMemorySourceReader(files, new Set([importedFile])),
        syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      });

      const first = await extraction.extractFile(file);
      const second = await extraction.extractFile(file);
      const firstTreePaths = pathBackedDefinitions(first.definitions);
      const secondTreePaths = pathBackedDefinitions(second.definitions);

      expect(firstTreePaths).toEqual([
        { id: "prompt:imported", path: ["a"] },
        { id: "prompt:local", path: ["z"] },
      ]);
      expect(JSON.stringify(secondTreePaths)).toBe(
        JSON.stringify(firstTreePaths),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses native facts from syntax records before invoking matching TypeScript extractors", async () => {
    const root = "/fixture";
    const file = "/fixture/src/workflow.ts";
    const source = [
      "import { nativePrompt } from '@acme/native'",
      "",
      "export const workflow = nativePrompt({ id: 'release' })",
    ].join("\n");
    const baseRecord = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["nativePrompt"],
    }).parseFile({
      root,
      file,
      source,
    });
    const match = baseRecord.matches[0];
    if (!match) throw new Error("Expected fixture match");
    const nativeFacts: ExtractedFacts = {
      definitions: [
        {
          variableName: "workflow",
          definition: {
            id: "@native.workflow:release",
            kind: "workflow" as ProjectDefinitionKind,
            name: "release",
            source: match.source,
            sourceSnippet: match.snippet,
            fidelity: "resolved",
            status: "active",
            fingerprint: nativeFingerprint({
              kind: "workflow",
              name: "release",
              file,
              text: match.snippet?.source,
            }),
            metadata: {
              exportName: "workflow",
              static: true,
            },
          },
        },
      ],
    };
    const record: StaticSyntaxFileRecord = {
      ...baseRecord,
      nativeFacts: [
        {
          matchIndex: 0,
          replaces: [
            { extension: "@acme/native-prompts", extractor: "native.prompt" },
          ],
          facts: nativeFacts,
        },
      ],
    };
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [throwingNativePromptExtension()],
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records: [record] }),
    });

    const extracted = await extraction.extractFile(file);

    expect(extracted.definitions).toEqual([
      expect.objectContaining({
        id: "@native.workflow:release",
        kind: "workflow",
        name: "release",
      }),
    ]);
  });

  it("runs third-party TS extractors for matches covered by first-party native facts", async () => {
    const root = "/fixture";
    const file = "/fixture/src/prompts.ts";
    const source = [
      "import { prompt } from '@use-crux/core'",
      "",
      "export const writer = prompt({ id: 'writer', system: 'You write.' })",
    ].join("\n");
    const baseRecord = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["prompt"],
    }).parseFile({ root, file, source });
    const match = baseRecord.matches[0];
    if (!match) throw new Error("Expected fixture match");
    const record: StaticSyntaxFileRecord = {
      ...baseRecord,
      nativeFacts: [
        {
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
          facts: nativePromptFactsForTest(match, file),
        },
      ],
    };
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [promptAuditExtension()],
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records: [record] }),
    });

    const extracted = await extraction.extractFile(file);

    expect(extracted.definitions.map((definition) => definition.id)).toContain(
      "prompt:writer",
    );
    expect(extracted.diagnostics).toEqual([
      expect.objectContaining({
        code: "prompt-audit",
        message: "Prompt audit extension inspected writer",
      }),
    ]);
  }, 30_000);

  it("projects the TypeScript extractor lane without emitting external native facts", async () => {
    const root = "/fixture";
    const file = "/fixture/src/prompts.ts";
    const source = [
      "import { prompt } from '@use-crux/core'",
      "",
      "export const writer = prompt({ id: 'writer', system: 'You write.' })",
    ].join("\n");
    const baseRecord = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["prompt"],
    }).parseFile({ root, file, source });
    const match = baseRecord.matches[0];
    if (!match) throw new Error("Expected fixture match");
    const record: StaticSyntaxFileRecord = {
      ...baseRecord,
      nativeFacts: [
        {
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
          facts: nativePromptFactsForTest(match, file),
        },
      ],
    };
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [promptAuditExtension()],
      nativeFactProjection: "external",
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records: [record] }),
    });

    const extracted = await extraction.extractFile(file);

    expect(
      extracted.definitions.map((definition) => definition.id),
    ).not.toContain("prompt:writer");
    expect(extracted.diagnostics).toEqual([
      expect.objectContaining({
        code: "prompt-audit",
        message: "Prompt audit extension inspected writer",
      }),
    ]);
  }, 30_000);

  it("projects the native fact lane without running TypeScript extractors", async () => {
    const root = "/fixture";
    const file = "/fixture/src/prompts.ts";
    const source = [
      "import { prompt } from '@use-crux/core'",
      "",
      "export const writer = prompt({ id: 'writer', system: 'You write.' })",
    ].join("\n");
    const baseRecord = await createTypeScriptStaticSyntaxFrontend({
      callNames: ["prompt"],
    }).parseFile({ root, file, source });
    const match = baseRecord.matches[0];
    if (!match) throw new Error("Expected fixture match");
    const record: StaticSyntaxFileRecord = {
      ...baseRecord,
      nativeFacts: [
        {
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
          facts: nativePromptFactsForTest(match, file),
        },
      ],
    };
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [promptAuditExtension()],
      nativeFactProjection: "native-only",
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: createProvidedStaticSyntaxFrontend({ records: [record] }),
    });

    const extracted = await extraction.extractFile(file);

    expect(extracted.definitions.map((definition) => definition.id)).toContain(
      "prompt:writer",
    );
    expect(
      extracted.diagnostics.map((diagnostic) => diagnostic.code),
    ).not.toContain("prompt-audit");
  }, 30_000);

  itWithRustOxc(
    "emits complete native prompt facts from the Rust/Oxc frontend",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/prompts.ts";
      const source = [
        "import { prompt } from '@use-crux/core'",
        "",
        "export const writer = prompt({ id: 'writer', system: 'You write.' })",
      ].join("\n");
      const rustFrontend = createRustOxcStaticSyntaxFrontend({
        callNames: ["prompt"],
      });
      const record = await rustFrontend.parseFile({ root, file, source });

      expect(record.nativeFacts ?? []).toMatchObject([
        {
          matchIndex: 0,
          replaces: [
            { extension: "@use-crux/indexer/crux-core", extractor: "prompt" },
          ],
        },
      ]);

      const tsExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      });
      const rustExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [record],
        }),
      });

      const [tsExtracted, rustExtracted] = await Promise.all([
        tsExtraction.extractFile(file),
        rustExtraction.extractFile(file),
      ]);

      expect(rustExtracted.definitions).toEqual(tsExtracted.definitions);
      expect(rustExtracted.relations).toEqual(tsExtracted.relations);
      expect(rustExtracted.diagnostics).toEqual(tsExtracted.diagnostics);
    },
    30_000,
  );

  itWithRustOxc(
    "keeps member prompt calls on the TypeScript extractor fallback path",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/eval.ts";
      const source = [
        "import { target } from '@use-crux/core/quality'",
        "",
        "export const task = target.prompt(writer, { model: runtime.model })",
      ].join("\n");
      const record = await createRustOxcStaticSyntaxFrontend({
        callNames: ["prompt"],
      }).parseFile({
        root,
        file,
        source,
      });

      expect(record.matches).toHaveLength(1);
      expect(record.nativeFacts ?? []).toEqual([]);
    },
    30_000,
  );

  itWithRustOxc(
    "emits exact native routing facts from the Rust/Oxc frontend",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/routing.ts";
      const source = routingFixtureSource();

      const rustRecord = await createRustOxcStaticSyntaxFrontend({
        callNames: ["router", "cascade", "fallback"],
      }).parseFile({
        root,
        file,
        source,
      });
      expect(rustRecord.nativeFacts ?? []).toHaveLength(3);
      expect(rustRecord.nativeFacts?.map((item) => item.replaces)).toEqual(
        rustRecord.nativeFacts?.map(() => [
          { extension: "@use-crux/indexer/crux-core", extractor: "routing" },
        ]),
      );

      const nativeExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [rustRecord],
        }),
      });
      const fallbackExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [{ ...rustRecord, nativeFacts: [] }],
        }),
      });

      const [nativeOut, fallbackOut] = await Promise.all([
        nativeExtraction.extractFile(file),
        fallbackExtraction.extractFile(file),
      ]);

      expect(nativeOut.definitions).toEqual(fallbackOut.definitions);
      expect(nativeOut.relations).toEqual(fallbackOut.relations);
      expect(nativeOut.diagnostics).toEqual(fallbackOut.diagnostics);
    },
    30_000,
  );

  itWithRustOxc(
    "prunes native routing match evidence without changing extracted output",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/routing.ts";
      const source = routingFixtureSource();
      const callNames = ["router", "cascade", "fallback"];
      const prunedRecord = await createRustOxcStaticSyntaxFrontend({
        callNames,
        pruneNativeFactCallNames: callNames,
      }).parseFile({ root, file, source });
      const fullRecord = await createRustOxcStaticSyntaxFrontend({
        callNames,
      }).parseFile({ root, file, source });

      expect(prunedRecord.nativeFacts ?? []).toHaveLength(3);
      expect(prunedRecord.matches).toHaveLength(fullRecord.matches.length);
      for (const match of prunedRecord.matches) {
        if (match.kind !== "call") continue;
        expect(match.args).toEqual([]);
        expect(match.objectArg).toBeUndefined();
        expect(match.snippet).toBeUndefined();
        expect(match.localInitializers ?? []).toEqual([]);
      }

      const nativeExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [prunedRecord],
        }),
      });
      const fallbackExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [{ ...fullRecord, nativeFacts: [] }],
        }),
      });

      const [nativeOut, fallbackOut] = await Promise.all([
        nativeExtraction.extractFile(file),
        fallbackExtraction.extractFile(file),
      ]);

      expect(nativeOut.definitions).toEqual(fallbackOut.definitions);
      expect(nativeOut.relations).toEqual(fallbackOut.relations);
      expect(nativeOut.diagnostics).toEqual(fallbackOut.diagnostics);
    },
    30_000,
  );

  it("keeps routing evidence when a third-party extractor matches the same call", async () => {
    const root = "/fixture";
    const file = "/fixture/src/routing.ts";
    const source = routingFixtureSource();
    const seenOptions: Parameters<
      typeof createTypeScriptStaticSyntaxFrontend
    >[0][] = [];
    const extraction = createStaticExtraction({
      root,
      cache: "none",
      extensions: [routerAuditExtension()],
      sources: memorySourceReader({ [file]: source }),
      syntaxFrontend: (options) => {
        seenOptions.push(options);
        return createTypeScriptStaticSyntaxFrontend(options);
      },
    });

    await extraction.extractFile(file);

    expect(seenOptions[0]?.pruneNativeFactCallNames).not.toContain("router");
    expect(seenOptions[0]?.pruneNativeFactCallNames).toEqual(
      expect.arrayContaining(["cascade", "fallback"]),
    );
  });
});

function itWithRustOxc(
  name: string,
  fn: () => Promise<void>,
  timeout?: number,
): void {
  const testName = rustOxcStatus.available
    ? name
    : `${name} [skipped: ${rustOxcStatus.reason ?? "Rust/Oxc unavailable"}]`;
  if (rustOxcStatus.available) {
    it(testName, fn, timeout);
    return;
  }
  it.skip(testName, fn, timeout);
}

function workflowExtension(): IndexerExtension {
  return {
    name: "@acme/workflows",
    version: "1",
    extractors: [
      {
        name: "workflow.define",
        patterns: [{ kind: "call", name: "defineWorkflow" }],
        extract: (ctx) => {
          const id = ctx.config?.string("id") ?? ctx.source.localName;
          return facts({
            definitions: [
              ctx.define.definition({
                variableName: ctx.source.variableName,
                id: `@acme.workflow:${id}`,
                kind: "workflow" as ProjectDefinitionKind,
                name: id,
                metadata: { exportName: ctx.source.variableName },
              }),
            ],
          });
        },
      },
    ],
  };
}

function throwingNativePromptExtension(): IndexerExtension {
  return {
    name: "@acme/native-prompts",
    version: "1",
    extractors: [
      {
        name: "native.prompt",
        patterns: [{ kind: "call", name: "nativePrompt" }],
        extract: () => {
          throw new Error(
            "TypeScript extractor fallback should not run when native facts are present",
          );
        },
      },
    ],
  };
}

function promptAuditExtension(): IndexerExtension {
  return {
    name: "@zz/prompt-audit",
    version: "1",
    extractors: [
      {
        name: "prompt.audit",
        patterns: [{ kind: "call", name: "prompt" }],
        extract: (ctx) =>
          facts({
            diagnostics: [
              {
                id: `${ctx.source.file}:prompt-audit`,
                severity: "info",
                code: "prompt-audit",
                message: `Prompt audit extension inspected ${ctx.source.variableName}`,
                source: { file: ctx.source.file, line: 1, column: 1 },
              } satisfies IndexDiagnostic,
            ],
          }),
      },
    ],
  };
}

function routerAuditExtension(): IndexerExtension {
  return {
    name: "@zz/router-audit",
    version: "1",
    extractors: [
      {
        name: "router.audit",
        patterns: [{ kind: "call", name: "router" }],
        extract: () => ({ kind: "none" }),
      },
    ],
  };
}

function memorySourceReader(
  files: Readonly<Record<string, string>>,
): SourceReader {
  return {
    read: async (file) => {
      const source = files[file];
      if (source === undefined)
        throw new Error(`Missing fixture source: ${file}`);
      return source;
    },
  };
}

function delayedMemorySourceReader(
  files: Readonly<Record<string, string>>,
  delayedFiles: ReadonlySet<string>,
): SourceReader {
  return {
    read: async (file) => {
      if (delayedFiles.has(file))
        await new Promise((resolve) => setTimeout(resolve, 10));
      const source = files[file];
      if (source === undefined)
        throw new Error(`Missing fixture source: ${file}`);
      return source;
    },
  };
}

function pathBackedDefinitions(
  definitions: StaticFileExtraction["definitions"],
) {
  return definitions.flatMap((definition) =>
    definition.path ? [{ id: definition.id, path: definition.path }] : [],
  );
}

function nativeFingerprint(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function nativePromptFactsForTest(
  match: StaticSourceMatch,
  file: string,
): ExtractedFacts {
  return {
    definitions: [
      {
        variableName: match.variableName,
        definition: {
          id: "prompt:writer",
          kind: "prompt",
          name: "writer",
          source: match.source,
          sourceSnippet: match.snippet,
          fidelity: "resolved",
          status: "active",
          fingerprint: nativeFingerprint({
            kind: "prompt",
            name: "writer",
            file,
            text: match.snippet?.source,
          }),
          metadata: {
            runtimeJoin: {
              definitionId: "prompt:writer",
              kind: "prompt",
              name: "writer",
              spanAttributes: { promptId: "writer" },
              primitive: "prompt.resolve",
              promptId: "writer",
            },
            exportName: match.variableName,
            hasOutput: false,
            facts: {
              kind: "prompt",
              use: [],
              hasSystem: true,
              hasPrompt: false,
              hasMessages: false,
              hasTests: false,
            },
            intelligence: { confidence: "static" },
            static: true,
          },
        },
      },
    ],
  };
}

function routingFixtureSource(): string {
  return [
    "import { cascade, fallback, router } from '@use-crux/core/routing'",
    "",
    'const classify = () => "draft"',
    "const evaluate = () => ({ accept: true })",
    "const writerAgent = {}",
    "const backupPrompt = {}",
    "",
    'export const resilientWriter = fallback(writerAgent, backupPrompt, { id: "resilient-writer" })',
    "export const qualityCascade = cascade({",
    '  id: "quality-cascade",',
    "  budget: { max: 100 },",
    '  tiers: [{ model: writerAgent, budget: 25, note: "fast", evaluate }],',
    "})",
    "export const qualityRouter = router({",
    '  id: "quality-router",',
    "  classify,",
    "  routes: { draft: qualityCascade, default: resilientWriter },",
    "})",
  ].join("\n");
}
