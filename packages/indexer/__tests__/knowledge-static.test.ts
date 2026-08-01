import { ProjectDefinitionKindSchema } from "@use-crux/core/project-index";
import { describe, expect, it } from "vitest";
import {
  createStaticExtraction,
  type SourceReader,
} from "../src/indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

describe("connected knowledge static indexing", () => {
  it("accepts Connected Knowledge definition kinds", () => {
    for (const kind of [
      "rag.knowledgeBase.view",
      "knowledge.relation",
      "knowledge.assertions",
      "knowledge.communities",
      "knowledge.model",
    ]) {
      expect(ProjectDefinitionKindSchema.parse(kind)).toBe(kind);
    }
  });

  it("indexes relation, assertion, communities, model, and view definitions", async () => {
    const extracted = await extract(
      [
        `import { assertions, communities, knowledgeBase, knowledgeModel, relate, relateEntities, relateReferences } from '@use-crux/core/knowledge'`,
        `const model = knowledgeModel({ name: 'extractor', version: 2, generateText, generateObject })`,
        `export const docs = knowledgeBase({ id: 'docs', communities: groups })`,
        `export const groups = communities({ id: 'topic-groups', model })`,
        `export const citations = relate({`,
        `  id: 'citations',`,
        `  version: 3,`,
        `  types: { cites: { from: ['chunk'], to: ['document'], direction: 'directed', description: 'Cites' } },`,
        `  model,`,
        `})`,
        `export const references = relateReferences()`,
        `export const entities = relateEntities({ model: knowledgeModel({ name: 'entity-inline', version: 1, generateText, generateObject }) })`,
        `export const claims = assertions({`,
        `  id: 'claims',`,
        `  version: 4,`,
        `  types: { risk: z.object({ level: z.string() }) },`,
        `  model,`,
        `})`,
        `export const published = docs.view({ id: 'published', where: { any: [{ status: 'published' }, { audience: ['external'] }] } })`,
      ].join("\n"),
    );

    expect(
      extracted.definitions.map((definition) => [
        definition.id,
        definition.kind,
        definition.metadata?.facts,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [
          "knowledge.model:extractor",
          "knowledge.model",
          expect.objectContaining({
            kind: "knowledge.model",
            modelName: "extractor",
            version: 2,
          }),
        ],
        [
          "rag.knowledgeBase:docs",
          "rag.knowledgeBase",
          expect.objectContaining({
            kind: "rag.knowledgeBase",
            knowledgeBaseId: "docs",
          }),
        ],
        [
          "knowledge.communities:topic-groups",
          "knowledge.communities",
          expect.objectContaining({
            kind: "knowledge.communities",
            communitiesId: "topic-groups",
          }),
        ],
        [
          "knowledge.relation:citations",
          "knowledge.relation",
          expect.objectContaining({
            kind: "knowledge.relation",
            relationId: "citations",
            version: 3,
            typeNames: ["cites"],
          }),
        ],
        [
          "knowledge.relation:references",
          "knowledge.relation",
          expect.objectContaining({
            kind: "knowledge.relation",
            relationId: "references",
            version: 1,
            typeNames: ["references"],
          }),
        ],
        [
          "knowledge.relation:entities",
          "knowledge.relation",
          expect.objectContaining({
            kind: "knowledge.relation",
            relationId: "entities",
            typeNames: ["mentions", "related"],
            modelName: "entity-inline",
          }),
        ],
        [
          "knowledge.assertions:claims",
          "knowledge.assertions",
          expect.objectContaining({
            kind: "knowledge.assertions",
            assertionId: "claims",
            version: 4,
            typeNames: ["risk"],
          }),
        ],
        [
          "rag.knowledgeBase:docs:view:published",
          "rag.knowledgeBase.view",
          expect.objectContaining({
            kind: "rag.knowledgeBase.view",
            knowledgeBaseId: "rag.knowledgeBase:docs",
            viewId: "published",
            whereFields: ["audience", "status"],
          }),
        ],
      ]),
    );
    expect(extracted.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rag.knowledgeBase.uses_communities",
          from: "rag.knowledgeBase:docs",
          to: "knowledge.communities:topic-groups",
        }),
        expect.objectContaining({
          type: "rag.knowledgeBase.includes_view",
          from: "rag.knowledgeBase:docs",
          to: "rag.knowledgeBase:docs:view:published",
        }),
        expect.objectContaining({
          type: "knowledge.relation.uses_model",
          from: "knowledge.relation:citations",
          to: "knowledge.model:extractor",
        }),
        expect.objectContaining({
          type: "knowledge.assertions.uses_model",
          from: "knowledge.assertions:claims",
          to: "knowledge.model:extractor",
        }),
        expect.objectContaining({
          type: "knowledge.communities.uses_model",
          from: "knowledge.communities:topic-groups",
          to: "knowledge.model:extractor",
        }),
      ]),
    );
  });

  it("indexes compat retrieval knowledge bases and ignores unrelated view calls", async () => {
    const extracted = await extract(
      [
        `import { knowledgeBase } from '@use-crux/core/retrieval'`,
        `export const docs = knowledgeBase({ id: 'legacy-docs' })`,
        `export const selected = docs.view({ id: 'selected', where: { kind: 'guide' } })`,
        `const unrelated = { view: (config: unknown) => config }`,
        `export const ignored = unrelated.view({ id: 'ignored', where: { kind: 'guide' } })`,
      ].join("\n"),
    );

    expect(extracted.definitions.map((definition) => definition.id)).toEqual([
      "rag.knowledgeBase:legacy-docs",
      "rag.knowledgeBase:legacy-docs:view:selected",
    ]);
    expect(extracted.definitions[1]?.metadata?.facts).toMatchObject({
      kind: "rag.knowledgeBase.view",
      whereFields: ["kind"],
    });
  });
});

async function extract(source: string) {
  const file = "/fixture/knowledge.ts";
  const reader: SourceReader = {
    read: async (requested) => {
      if (requested !== file) throw new Error(`Unexpected source: ${requested}`);
      return source;
    },
  };
  return createStaticExtraction({
    root: "/fixture",
    cache: "none",
    sources: reader,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  }).extractFile(file);
}
