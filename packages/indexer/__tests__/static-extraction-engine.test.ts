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
} from "../src/indexer/extensions";
import {
  createStaticExtraction,
  type SourceReader,
  type StaticFileExtraction,
} from "../src/indexer/static/extraction/engine";
import {
  createProvidedStaticSyntaxFrontend,
  createTypeScriptStaticSyntaxFrontend,
  type StaticSourceMatch,
  type StaticSyntaxFileRecord,
} from "../src/indexer/static-index/syntax";
import {
  createRustOxcStaticSyntaxFrontend,
  rustOxcSyntaxFrontendTestStatus,
} from "../src/testing/rust-oxc-frontend";
import {
  assertDeterministicExtraction,
  defineIndexerExtensionFixture,
  extractFixtureSource,
} from "../src/testing";

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
          version: "3",
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
            version: "oxc_parser@0.139.0+crux_native_group3.9",
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

      const rustExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [record],
        }),
      });

      const rustExtracted = await rustExtraction.extractFile(file);

      expect(
        rustExtracted.definitions.map((definition) => definition.id),
      ).toContain("prompt:writer");
      expect(rustExtracted.relations).toEqual([]);
      expect(rustExtracted.diagnostics).toEqual([]);
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
        callNames: ["router", "split", "retry", "cascade", "fallback"],
      }).parseFile({
        root,
        file,
        source,
      });
      expect(rustRecord.nativeFacts ?? []).toHaveLength(5);
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
      const nativeOut = await nativeExtraction.extractFile(file);

      expect(
        nativeOut.definitions.map((definition) => definition.kind),
      ).toEqual(
        expect.arrayContaining([
          "routing.router",
          "routing.cascade",
          "routing.fallback",
          "routing.retry",
          "routing.retry.target",
          "routing.split",
          "routing.split.route",
        ]),
      );
      expect(nativeOut.relations.map((relation) => relation.type)).toEqual(
        expect.arrayContaining([
          "router.includes_route",
          "cascade.includes_tier",
          "fallback.includes_option",
          "retry.uses_target",
          "split.includes_route",
        ]),
      );
      const routerRouteFacts = nativeOut.definitions.find(
        (definition) =>
          definition.id === "routing.router:quality-router:route:draft",
      )?.metadata?.facts;
      expect(
        routerRouteFacts?.kind === "routing.router.route"
          ? routerRouteFacts.profile
          : undefined,
      ).toEqual({ temperature: 0.2, maxTokens: 1200 });
      const splitRouteFacts = nativeOut.definitions.find(
        (definition) =>
          definition.id === "routing.split:canary-split:route:stable",
      )?.metadata?.facts;
      expect(
        splitRouteFacts?.kind === "routing.split.route"
          ? splitRouteFacts.profile
          : undefined,
      ).toEqual({ weight: 95, temperature: 0.1 });
      expect(
        nativeOut.diagnostics.map((diagnostic) => diagnostic.code),
      ).toEqual([
        "relation.unresolved_reference",
        "relation.unresolved_reference",
        "relation.unresolved_reference",
        "relation.unresolved_reference",
      ]);
    },
    30_000,
  );

  itWithRustOxc(
    "prunes native routing match evidence without changing extracted output",
    async () => {
      const root = "/fixture";
      const file = "/fixture/src/routing.ts";
      const source = routingFixtureSource();
      const callNames = ["router", "split", "retry", "cascade", "fallback"];
      const prunedRecord = await createRustOxcStaticSyntaxFrontend({
        callNames,
        pruneNativeFactCallNames: callNames,
      }).parseFile({ root, file, source });
      const fullRecord = await createRustOxcStaticSyntaxFrontend({
        callNames,
      }).parseFile({ root, file, source });

      expect(prunedRecord.nativeFacts ?? []).toHaveLength(5);
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
      const fullExtraction = createStaticExtraction({
        root,
        cache: "none",
        sources: memorySourceReader({ [file]: source }),
        syntaxFrontend: createProvidedStaticSyntaxFrontend({
          records: [fullRecord],
        }),
      });

      const [nativeOut, fullOut] = await Promise.all([
        nativeExtraction.extractFile(file),
        fullExtraction.extractFile(file),
      ]);

      expect(nativeOut.definitions).toEqual(fullOut.definitions);
      expect(nativeOut.relations).toEqual(fullOut.relations);
      expect(nativeOut.diagnostics).toEqual(fullOut.diagnostics);
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

    expect(seenOptions[0]?.pruneNativeFactCallNames).toEqual([]);
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
    "import { cascade, fallback, retry, router, split } from '@use-crux/core/routing'",
    "",
    'const classify = () => "draft"',
    'const seed = () => "session-1"',
    "const evaluate = () => ({ accept: true })",
    "const writerAgent = {}",
    "const backupPrompt = {}",
    "",
    'export const retriedWriter = retry(writerAgent, { id: "retried-writer", attempts: 2 })',
    'export const resilientWriter = fallback([retriedWriter, backupPrompt], { id: "resilient-writer" })',
    "export const canarySplit = split({",
    '  id: "canary-split",',
    "  seed,",
    "  routes: { stable: { model: writerAgent, weight: 95, temperature: 0.1 }, canary: { model: backupPrompt, weight: 5 } },",
    "})",
    "export const qualityCascade = cascade({",
    '  id: "quality-cascade",',
    "  budget: { max: 100 },",
    '  tiers: [{ model: canarySplit, budget: 25, note: "fast", evaluate }],',
    "})",
    "export const qualityRouter = router({",
    '  id: "quality-router",',
    "  classify,",
    "  routes: { draft: { model: qualityCascade, temperature: 0.2, maxTokens: 1200 }, default: resilientWriter },",
    "})",
  ].join("\n");
}
