import type { KnowledgeDefinitionFacts } from "@use-crux/core/project-index";
import { facts, none, type ExtractContext } from "../extensions";
import { internalStaticRecordContext } from "../static-index/compatibility/syntax-record-bridge/native-context";
import type { StaticObjectValue } from "../static-index/syntax/record/types";
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
} from "../static-index/syntax/record/value";
import { extractKnowledgeView } from "./view-static-facts";

const knowledgeBaseModules = new Set([
  "@use-crux/core/knowledge",
  "@use-crux/core/retrieval",
  "@use-crux/core",
]);

/** Projects authored Connected Knowledge definitions from static syntax. */
export function extractKnowledgeStaticFacts(ctx: ExtractContext) {
  switch (ctx.match.name) {
    case "knowledgeBase":
      return extractKnowledgeBase(ctx);
    case "relate":
      return extractRelate(ctx);
    case "relateReferences":
      return extractBuiltInRelation(ctx, "references", ["references"]);
    case "relateEntities":
      return extractBuiltInRelation(ctx, "entities", ["mentions", "related"]);
    case "assertions":
      return extractAssertions(ctx);
    case "communities":
      return extractCommunities(ctx);
    case "knowledgeModel":
      return extractKnowledgeModel(ctx);
    case "view":
      return extractKnowledgeView(ctx);
    default:
      return none();
  }
}

function extractKnowledgeBase(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config || !knowledgeBaseModules.has(ctx.match.moduleSpecifier ?? "")) {
    return none();
  }
  const knowledgeBaseId = config.string("id");
  const id = `rag.knowledgeBase:${ctx.source.safeId(
    knowledgeBaseId ?? ctx.source.localName,
  )}`;
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "rag.knowledgeBase",
    knowledgeBaseId: knowledgeBaseId ?? ctx.source.variableName,
    ...(config.string("namespace")
      ? { namespace: config.string("namespace") }
      : {}),
  };
  const communities = config.identifier("communities");
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "rag.knowledgeBase",
        name: knowledgeBaseId ?? ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: factsValue,
        },
      }),
    ],
    ...(communities
      ? {
          references: [
            ctx.ref.variable("rag.knowledgeBase.uses_communities", communities),
          ],
        }
      : {}),
  });
}

function extractRelate(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config) return none();
  return relationDefinition(ctx, {
    defaultId: ctx.source.variableName,
    typeNames: objectKeys(config.json("types")),
  });
}

function extractBuiltInRelation(
  ctx: ExtractContext,
  defaultId: string,
  typeNames: readonly string[],
) {
  return relationDefinition(ctx, {
    defaultId,
    typeNames,
    modelName: modelName(ctx),
  });
}

function relationDefinition(
  ctx: ExtractContext,
  input: {
    readonly defaultId: string;
    readonly typeNames: readonly string[];
    readonly modelName?: string;
  },
) {
  const config = ctx.config;
  const relationId = config?.string("id") ?? input.defaultId;
  const version = config?.number("version") ?? (config ? undefined : 1);
  const id = `knowledge.relation:${ctx.source.safeId(relationId)}`;
  const model = config?.identifier("model");
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "knowledge.relation",
    relationId,
    ...(version !== undefined ? { version } : {}),
    ...(input.typeNames.length ? { typeNames: input.typeNames } : {}),
    ...(input.modelName ? { modelName: input.modelName } : {}),
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "knowledge.relation",
        name: relationId,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: factsValue,
        },
      }),
    ],
    ...(model
      ? { references: [ctx.ref.variable("knowledge.relation.uses_model", model)] }
      : {}),
  });
}

function extractAssertions(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config) return none();
  const assertionId = config.string("id") ?? ctx.source.variableName;
  const version = config.number("version");
  const id = `knowledge.assertions:${ctx.source.safeId(assertionId)}`;
  const model = config.identifier("model");
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "knowledge.assertions",
    assertionId,
    ...(version !== undefined ? { version } : {}),
    typeNames: objectKeys(config.json("types")),
    ...(modelName(ctx) ? { modelName: modelName(ctx) } : {}),
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "knowledge.assertions",
        name: assertionId,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: factsValue,
        },
      }),
    ],
    ...(model
      ? {
          references: [
            ctx.ref.variable("knowledge.assertions.uses_model", model),
          ],
        }
      : {}),
  });
}

function extractCommunities(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config) return none();
  const communitiesId = config.string("id") ?? "communities";
  const id = `knowledge.communities:${ctx.source.safeId(communitiesId)}`;
  const model = config.identifier("model");
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "knowledge.communities",
    communitiesId,
    ...(modelName(ctx) ? { modelName: modelName(ctx) } : {}),
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "knowledge.communities",
        name: communitiesId,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: factsValue,
        },
      }),
    ],
    ...(model
      ? {
          references: [
            ctx.ref.variable("knowledge.communities.uses_model", model),
          ],
        }
      : {}),
  });
}

function extractKnowledgeModel(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config) return none();
  const modelNameValue = config.string("name") ?? ctx.source.variableName;
  const version = config.string("version") ?? config.number("version");
  const id = `knowledge.model:${ctx.source.safeId(modelNameValue)}`;
  const factsValue: KnowledgeDefinitionFacts = {
    kind: "knowledge.model",
    modelName: modelNameValue,
    ...(version !== undefined ? { version } : {}),
  };
  return facts({
    definitions: [
      ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: "knowledge.model",
        name: modelNameValue,
        metadata: {
          exportName: ctx.source.variableName,
          ...(ctx.source.exported ? { exported: true } : {}),
          facts: factsValue,
        },
      }),
    ],
  });
}

function modelName(ctx: ExtractContext): string | undefined {
  const native = internalStaticRecordContext(ctx);
  const model = native?.objectArg
    ? staticObjectPropertyValue(native.objectArg, "model")
    : undefined;
  const resolved = resolveStaticSyntaxValue(model, native?.initializers ?? new Map());
  if (resolved?.kind === "call" && resolved.args[0]?.kind === "object") {
    return directStringProperty(resolved.args[0], "name");
  }
  return undefined;
}

function directStringProperty(
  object: StaticObjectValue,
  property: string,
): string | undefined {
  const value = staticObjectPropertyValue(object, property);
  return value?.kind === "literal" && typeof value.value === "string"
    ? value.value
    : undefined;
}

function objectKeys(value: unknown): readonly string[] {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];
}
