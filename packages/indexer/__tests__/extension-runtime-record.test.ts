import type { ProjectDefinitionKind } from "@use-crux/core/project-index";
import { describe, expect, it } from "vitest";
import {
  createIndexerExtensionRuntime,
  facts,
  type IndexerExtension,
} from "../indexer/extensions";
import { cruxCoreExtension } from "../indexer/extractors/crux-core-extension";
import { staticParseResultFromFacts } from "../indexer/static/read-model";
import {
  createParseMemo,
  type SourceReader,
} from "../indexer/static/extraction/source-io";
import {
  createTypeScriptStaticSyntaxFrontend,
  parseStaticFactsFromSyntaxRecords,
} from "../indexer/static-index/syntax";

describe("indexer extension record runtime", () => {
  it("runs a matching static extractor from syntax records through stable readers and builders", async () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: "@acme/workflows",
          version: "1",
          extractors: [
            {
              name: "workflow.define",
              patterns: [
                {
                  kind: "call",
                  name: "defineWorkflow",
                  importFrom: ["@acme/workflows"],
                },
              ],
              extract: (ctx) => {
                const name = ctx.args.string(0) ?? "missing";
                const target = ctx.config?.reference("target") ?? "missing";
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `@acme.workflow:${ctx.config?.string("id") ?? ctx.source.localName}`,
                      kind: "workflow" as ProjectDefinitionKind,
                      name,
                      metadata: {
                        enabled: ctx.config?.boolean("enabled"),
                        tags: ctx.config?.stringArray("tags"),
                        target,
                        nestedMode: ctx.config
                          ?.object("nested")
                          ?.string("mode"),
                        matchKind: ctx.match.kind,
                      },
                    }),
                  ],
                  references: [
                    ctx.ref.variable("@acme.workflow/uses_tool", target),
                  ],
                });
              },
            },
          ],
        }),
      ],
    });
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: ["defineWorkflow"],
    });
    const record = await frontend.parseFile({
      root: "/project",
      file: "/project/src/workflow.ts",
      source: [
        "import { defineWorkflow as define } from '@acme/workflows'",
        'const writerTool = tool({ name: "writer" })',
        "export const workflow = define('publish', {",
        "  id: 'publish',",
        "  enabled: true,",
        "  tags: ['release'],",
        "  target: writerTool,",
        "  nested: { mode: 'fast' },",
        "})",
      ].join("\n"),
    });

    const match = record.matches.find(
      (item) => item.variableName === "workflow",
    );

    expect(match).toBeDefined();
    expect(
      runtime.extractStaticRecord({
        root: "/project",
        record,
        match: match!,
      }),
    ).toEqual({
      kind: "matched",
      extension: { name: "@acme/workflows", version: "1" },
      extractor: "workflow.define",
      dependencies: [
        { kind: "extension", name: "@acme/workflows", version: "1" },
        {
          kind: "extractor",
          extension: "@acme/workflows",
          name: "workflow.define",
        },
      ],
      diagnostics: [],
      facts: {
        definitions: [
          {
            variableName: "workflow",
            definition: expect.objectContaining({
              id: "@acme.workflow:publish",
              kind: "workflow",
              name: "publish",
              metadata: expect.objectContaining({
                enabled: true,
                tags: ["release"],
                target: "writerTool",
                nestedMode: "fast",
                matchKind: "call",
              }),
            }),
          },
        ],
        references: [
          { type: "@acme.workflow/uses_tool", toVariable: "writerTool" },
        ],
      },
    });
  });

  it("preserves first-party prompt references from syntax-record config readers", async () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [cruxCoreExtension],
    });
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: runtime.manifest.callNames,
    });
    const record = await frontend.parseFile({
      root: "/project",
      file: "/project/src/prompt.ts",
      source: [
        "const guardrails = [privacyGuardrail]",
        "export const writer = prompt({",
        "  id: 'writer',",
        "  use: [brandContext],",
        "  tools: { search: searchTool },",
        "  constraints: [policyConstraint],",
        "  guardrails,",
        "  prompt: 'Write',",
        "})",
      ].join("\n"),
    });
    const match = record.matches.find((item) => item.variableName === "writer");

    expect(match).toBeDefined();
    const result = runtime.extractStaticRecord({
      root: "/project",
      record,
      match: match!,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "matched",
        extractor: "prompt",
        facts: expect.objectContaining({
          definitions: [
            expect.objectContaining({
              definition: expect.objectContaining({
                id: "prompt:writer",
                metadata: expect.objectContaining({
                  facts: expect.objectContaining({
                    use: ["brandContext"],
                    useEntries: [
                      expect.objectContaining({ variable: "brandContext" }),
                    ],
                    tools: {
                      hasTools: true,
                      names: ["search"],
                      variables: ["searchTool"],
                    },
                    constraints: ["policyConstraint"],
                    guardrails: ["privacyGuardrail"],
                  }),
                }),
              }),
            }),
          ],
          references: expect.arrayContaining([
            expect.objectContaining({
              type: "prompt.uses_context",
              toVariable: "brandContext",
            }),
            expect.objectContaining({
              type: "prompt.uses_tool",
              toVariable: "searchTool",
            }),
            expect.objectContaining({
              type: "constraint.applies_to",
              fromVariable: "policyConstraint",
            }),
            expect.objectContaining({
              type: "guardrail.applies_to",
              fromVariable: "privacyGuardrail",
            }),
          ]),
        }),
      }),
    );
  });

  it("preserves first-party callback source refs from syntax records", async () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [cruxCoreExtension],
    });
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: runtime.manifest.callNames,
    });
    const record = await frontend.parseFile({
      root: "/project",
      file: "/project/src/prompt.ts",
      source: [
        "const promptBody = () => 'Write'",
        "export const writer = prompt({",
        "  id: 'writer',",
        "  prompt: promptBody,",
        "})",
      ].join("\n"),
    });
    const match = record.matches.find((item) => item.variableName === "writer");

    expect(match).toBeDefined();
    const result = runtime.extractStaticRecord({
      root: "/project",
      record,
      match: match!,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "matched",
        facts: expect.objectContaining({
          sourceRefs: [
            expect.objectContaining({
              definitionId: "prompt:writer",
              ref: expect.objectContaining({
                id: "prompt:writer:source:prompt:prompt:promptBody",
                role: "prompt",
                property: "prompt",
                symbol: "promptBody",
                source: expect.objectContaining({
                  file: "/project/src/prompt.ts",
                  line: 1,
                  column: 20,
                }),
                snippet: expect.objectContaining({ source: "() => 'Write'" }),
              }),
            }),
          ],
        }),
      }),
    );
  });

  it("extracts first-party router definitions from syntax records", async () => {
    const runtime = createIndexerExtensionRuntime({
      extensions: [cruxCoreExtension],
    });
    const frontend = createTypeScriptStaticSyntaxFrontend({
      callNames: runtime.manifest.callNames,
    });
    const record = await frontend.parseFile({
      root: "/project",
      file: "/project/src/router.ts",
      source: [
        "const classifyRoute = () => 'default'",
        "export const qualityRouter = router({",
        "  id: 'quality-router',",
        "  routes: { default: writerPrompt },",
        "  classify: classifyRoute,",
        "})",
      ].join("\n"),
    });
    const match = record.matches.find(
      (item) => item.variableName === "qualityRouter",
    );

    expect(match).toBeDefined();
    const result = runtime.extractStaticRecord({
      root: "/project",
      record,
      match: match!,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "matched",
        extractor: "routing",
        facts: expect.objectContaining({
          definitions: [
            expect.objectContaining({
              definition: expect.objectContaining({
                id: "routing.router:quality-router",
                kind: "routing.router",
                metadata: expect.objectContaining({
                  routeKeys: ["default"],
                  routeCount: 1,
                  hasDefaultRoute: true,
                  hasClassify: true,
                }),
              }),
              extraDefinitions: [
                expect.objectContaining({
                  id: "routing.router:quality-router:route:default",
                  kind: "routing.router.route",
                  metadata: expect.objectContaining({
                    targetVariable: "writerPrompt",
                  }),
                }),
              ],
            }),
          ],
          references: expect.arrayContaining([
            expect.objectContaining({
              type: "router.includes_route",
              toId: "routing.router:quality-router:route:default",
            }),
            expect.objectContaining({
              type: "router.route.uses_router",
              fromId: "routing.router:quality-router:route:default",
              toVariable: "writerPrompt",
            }),
          ]),
          sourceRefs: [
            expect.objectContaining({
              definitionId: "routing.router:quality-router",
              ref: expect.objectContaining({
                role: "callback",
                property: "classify",
                symbol: "classifyRoute",
              }),
            }),
          ],
        }),
      }),
    );
  });

  it("extracts nested calls inside variable initializers from syntax records", async () => {
    const root = "/project";
    const file = "/project/src/prompt.ts";
    const runtime = createIndexerExtensionRuntime({
      extensions: [cruxCoreExtension],
    });
    const files = {
      [file]: [
        "const local = withRetry(prompt({ id: 'local' }))",
        "export const exported = withRetry(prompt({ id: 'exported' }))",
        "const { nested = prompt({ id: 'destructured' }) } = config",
      ].join("\n"),
    };

    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        frontend: createTypeScriptStaticSyntaxFrontend({
          callNames: runtime.manifest.callNames,
        }),
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    );

    expect(
      projectedCore(record).definitions.map((definition) => definition.id),
    ).toEqual(["prompt:destructured", "prompt:exported", "prompt:local"]);
  });

  it("keeps anonymous agent fallback names stable through syntax records", async () => {
    const root = "/project";
    const file = "/project/src/agent.ts";
    const runtime = createIndexerExtensionRuntime({
      extensions: [cruxCoreExtension],
    });
    const files = {
      [file]: "agent({ prompt: writerPrompt })",
    };

    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        frontend: createTypeScriptStaticSyntaxFrontend({
          callNames: runtime.manifest.callNames,
        }),
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    );

    expect(projectedAgentNames(record)).toEqual([
      { id: "agent:src-agent.ts:agent-1", name: "agent-1" },
    ]);
  });

  it("resolves record initializers by lexical scope and source position", async () => {
    const root = "/project";
    const file = "/project/src/workflow.ts";
    const runtime = createIndexerExtensionRuntime({
      extensions: [
        extension({
          name: "@acme/workflows",
          version: "1",
          extractors: [
            {
              name: "workflow.define",
              patterns: [
                { kind: "call", name: "defineWorkflow", configArg: 0 },
              ],
              extract: (ctx) => {
                const id = ctx.config?.string("id") ?? "missing";
                return facts({
                  definitions: [
                    ctx.define.definition({
                      variableName: ctx.source.variableName,
                      id: `workflow:${id}`,
                      kind: "workflow" as ProjectDefinitionKind,
                      name: id,
                    }),
                  ],
                });
              },
            },
          ],
        }),
      ],
    });
    const files = {
      [file]: [
        "export function buildWorkflow() {",
        "  const config = { id: 'outer' }",
        "  const workflow = defineWorkflow(config)",
        "  items.map(() => {",
        "    const config = { id: 'inner' }",
        "    return config",
        "  })",
        "  return workflow",
        "}",
      ].join("\n"),
    };

    const record = staticParseResultFromFacts(
      await parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        frontend: createTypeScriptStaticSyntaxFrontend({
          callNames: runtime.manifest.callNames,
        }),
        parseMemo: createParseMemo(memorySourceReader(files)),
      }),
    );

    expect(
      projectedCore(record).definitions.map((definition) => definition.id),
    ).toEqual(["workflow:outer"]);
  });
});

function extension(input: IndexerExtension): IndexerExtension {
  return input;
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

function projectedCore(result: {
  readonly definitions: readonly {
    readonly id: string;
    readonly kind: string;
    readonly metadata?: unknown;
  }[];
  readonly relations: readonly {
    readonly type: string;
    readonly from: string;
    readonly to: string;
  }[];
}) {
  return {
    definitions: result.definitions
      .map((definition) => ({
        id: definition.id,
        kind: definition.kind,
        facts: isRecord(definition.metadata)
          ? definition.metadata.facts
          : undefined,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    relations: result.relations
      .map((relation) => ({
        type: relation.type,
        from: relation.from,
        to: relation.to,
      }))
      .sort((a, b) =>
        `${a.type}:${a.from}:${a.to}`.localeCompare(
          `${b.type}:${b.from}:${b.to}`,
        ),
      ),
  };
}

function projectedAgentNames(result: {
  readonly definitions: readonly {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
  }[];
}) {
  return result.definitions
    .filter((definition) => definition.kind === "agent")
    .map((definition) => ({ id: definition.id, name: definition.name }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
