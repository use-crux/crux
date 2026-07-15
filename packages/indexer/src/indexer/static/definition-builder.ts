import ts from "typescript";
import type {
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRuntimeJoin,
  SourceLocation,
  SourceSnippet,
} from "@use-crux/core/project-index";
import { stringArrayProperty, stringProperty } from "../ast/literals";
import { definitionFingerprintFile, fingerprint } from "../definitions";

/**
 * Builds a resolved Project Index definition from static syntax facts.
 *
 * The builder is pure: it reads only the provided AST/object metadata, does not
 * mutate its inputs, and returns a fresh definition with stable fingerprint and
 * runtime-join metadata.
 */
export function staticDefinition(
  root: string,
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  objectArg: ts.ObjectLiteralExpression | undefined,
  source: SourceLocation,
  sourceSnippetValue: SourceSnippet | undefined,
  metadata: Record<string, unknown>,
): ProjectDefinition {
  const tags = objectArg ? stringArrayProperty(objectArg, "tags") : undefined;
  return {
    id,
    kind,
    name,
    description: objectArg
      ? stringProperty(objectArg, "description")
      : undefined,
    tags,
    source,
    sourceSnippet: sourceSnippetValue,
    fidelity: "resolved",
    status: "active",
    fingerprint: fingerprint({
      kind,
      name,
      file: definitionFingerprintFile(root, file),
      text: sourceSnippetValue?.source,
    }),
    metadata: {
      ...runtimeJoinMetadata(id, kind, name, metadata),
      ...metadata,
      static: true,
    },
  };
}

/** Builds a static Project Index definition with the same metadata defaults as parser extraction. */
export function staticDefinitionForTesting(
  root: string,
  file: string,
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  objectArg: ts.ObjectLiteralExpression | undefined,
  source: SourceLocation,
  sourceSnippetValue: SourceSnippet | undefined,
  metadata: Record<string, unknown>,
): ProjectDefinition {
  return staticDefinition(
    root,
    file,
    id,
    kind,
    name,
    objectArg,
    source,
    sourceSnippetValue,
    metadata,
  );
}

/** Computes authored-to-runtime join hints for definition kinds that can be correlated with spans. */
function runtimeJoinMetadata(
  id: string,
  kind: ProjectDefinitionKind,
  name: string,
  metadata: Record<string, unknown>,
): { runtimeJoin: ProjectRuntimeJoin } {
  const spanAttributes: Record<string, string> = {};
  const runtimeJoin: ProjectRuntimeJoin = {
    definitionId: id,
    kind,
    name,
    spanAttributes,
  };

  switch (kind) {
    case "prompt":
      runtimeJoin.primitive = "prompt.resolve";
      spanAttributes.promptId = id.slice("prompt:".length);
      runtimeJoin.promptId = spanAttributes.promptId;
      break;
    case "context":
      runtimeJoin.primitive = "context.resolve";
      spanAttributes.contextId = id.slice("context:".length);
      runtimeJoin.contextId = spanAttributes.contextId;
      break;
    case "tool":
      runtimeJoin.primitive = "tool.call";
      spanAttributes.toolName = name;
      runtimeJoin.toolName = name;
      break;
    case "agent":
      runtimeJoin.primitive = "agent.run";
      runtimeJoin.spanName = name;
      spanAttributes.agentId = String(
        metadata.agentId ?? id.slice("agent:".length),
      );
      runtimeJoin.agentId = spanAttributes.agentId;
      break;
    case "flow":
      runtimeJoin.primitive = "flow.run";
      runtimeJoin.spanName = name;
      runtimeJoin.correlationAttributes = ["flowId", "parentFlowId"];
      break;
    case "flow.step":
      runtimeJoin.primitive = "flow.step";
      runtimeJoin.spanName = name;
      runtimeJoin.stepLabel = name;
      spanAttributes.stepLabel = name;
      if (typeof metadata.flowId === "string") {
        runtimeJoin.parentDefinitionId = metadata.flowId;
        runtimeJoin.flowName = stripDefinitionPrefix(metadata.flowId, "flow:");
      }
      runtimeJoin.correlationAttributes = ["flowId", "stepId"];
      break;
    case "routing.router":
      runtimeJoin.primitive = "routing.router";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(id, "routing.router:"),
      );
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.router.route":
      runtimeJoin.primitive = "routing.router";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ??
          stripDefinitionPrefix(
            String(metadata.routerDefinitionId ?? ""),
            "routing.router:",
          ),
      );
      spanAttributes.classifiedAs = String(metadata.routeKey ?? name);
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.routeKey = spanAttributes.classifiedAs;
      if (typeof metadata.routerDefinitionId === "string") {
        runtimeJoin.parentDefinitionId = metadata.routerDefinitionId;
      }
      runtimeJoin.correlationAttributes = ["routingId", "classifiedAs"];
      break;
    case "routing.split":
      runtimeJoin.primitive = "routing.split";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(id, "routing.split:"),
      );
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.split.route":
      runtimeJoin.primitive = "routing.split";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ??
          stripDefinitionPrefix(
            String(metadata.splitDefinitionId ?? ""),
            "routing.split:",
          ),
      );
      spanAttributes.route = String(metadata.routeKey ?? name);
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.routeKey = spanAttributes.route;
      if (typeof metadata.splitDefinitionId === "string") {
        runtimeJoin.parentDefinitionId = metadata.splitDefinitionId;
      }
      runtimeJoin.correlationAttributes = ["routingId", "route"];
      break;
    case "routing.retry":
      runtimeJoin.primitive = "routing.retry";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(id, "routing.retry:"),
      );
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.retry.target":
      runtimeJoin.primitive = "routing.retry";
      runtimeJoin.spanName = name;
      if (typeof metadata.routingId === "string") {
        spanAttributes.routingId = metadata.routingId;
        runtimeJoin.routingId = metadata.routingId;
      }
      if (typeof metadata.retryDefinitionId === "string") {
        runtimeJoin.parentDefinitionId = metadata.retryDefinitionId;
      }
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.cascade":
      runtimeJoin.primitive = "routing.cascade";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ?? stripDefinitionPrefix(id, "routing.cascade:"),
      );
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.cascade.tier":
      runtimeJoin.primitive = "routing.cascade";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ??
          stripDefinitionPrefix(
            String(metadata.cascadeDefinitionId ?? ""),
            "routing.cascade:",
          ),
      );
      if (typeof metadata.tierIndex === "number")
        spanAttributes.tierIndex = String(metadata.tierIndex);
      if (typeof metadata.cascadeDefinitionId === "string") {
        runtimeJoin.parentDefinitionId = metadata.cascadeDefinitionId;
      }
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId", "tierIndex"];
      break;
    case "routing.fallback":
      runtimeJoin.primitive = "routing.fallback";
      runtimeJoin.spanName = name;
      spanAttributes.routingId = String(
        metadata.routingId ??
          (stripDefinitionPrefix(id, "routing.fallback:") || name),
      );
      runtimeJoin.routingId = spanAttributes.routingId;
      runtimeJoin.correlationAttributes = ["routingId"];
      break;
    case "routing.fallback.option":
      runtimeJoin.primitive = "routing.fallback";
      runtimeJoin.spanName = name;
      if (typeof metadata.routingId === "string") {
        spanAttributes.routingId = metadata.routingId;
        runtimeJoin.routingId = metadata.routingId;
      }
      if (typeof metadata.optionIndex === "number")
        spanAttributes.attempt = String(metadata.optionIndex + 1);
      if (typeof metadata.fallbackDefinitionId === "string") {
        runtimeJoin.parentDefinitionId = metadata.fallbackDefinitionId;
      }
      runtimeJoin.correlationAttributes = ["routingId", "attempt"];
      break;
    case "memory":
      runtimeJoin.primitive = "memory.*";
      spanAttributes.memoryId = stripDefinitionPrefix(id, "memory:");
      spanAttributes.sourceDefinitionId = id;
      runtimeJoin.memoryId = spanAttributes.memoryId;
      runtimeJoin.sourceDefinitionId = id;
      if (typeof metadata.runtimeIdPrefix === "string")
        runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix;
      break;
    case "memory.store":
      runtimeJoin.resource = "memory.store";
      runtimeJoin.memoryStoreId = stripDefinitionPrefix(id, "memory.store:");
      if (typeof metadata.backend === "string")
        runtimeJoin.backend = metadata.backend;
      break;
    case "memory.block":
      runtimeJoin.primitive = "memory.*";
      runtimeJoin.blockDefinitionId = id;
      spanAttributes.blockDefinitionId = id;
      if (typeof metadata.memoryId === "string") {
        spanAttributes.sourceDefinitionId = metadata.memoryId;
        spanAttributes.memoryId = stripDefinitionPrefix(
          metadata.memoryId,
          "memory:",
        );
        runtimeJoin.sourceDefinitionId = metadata.memoryId;
        runtimeJoin.memoryId = spanAttributes.memoryId;
      }
      if (typeof metadata.blockId === "string") {
        spanAttributes.blockId = metadata.blockId;
        runtimeJoin.blockId = metadata.blockId;
      }
      if (typeof metadata.blockKind === "string") {
        spanAttributes.blockKind = metadata.blockKind;
        runtimeJoin.blockKind = metadata.blockKind;
      }
      break;
    case "blackboard":
      runtimeJoin.primitive = "memory.*";
      spanAttributes.memoryId = stripDefinitionPrefix(id, "blackboard:");
      spanAttributes.blockId = spanAttributes.memoryId;
      spanAttributes.memoryType = "blackboard";
      spanAttributes.sourceDefinitionId = id;
      runtimeJoin.memoryId = spanAttributes.memoryId;
      runtimeJoin.blockId = spanAttributes.blockId;
      runtimeJoin.sourceDefinitionId = id;
      if (typeof metadata.runtimeIdPrefix === "string")
        runtimeJoin.runtimeIdPrefix = metadata.runtimeIdPrefix;
      break;
    case "rag.retriever":
      runtimeJoin.primitive = "retrieval.*";
      spanAttributes.retrieverId = id.slice("rag.retriever:".length);
      runtimeJoin.retrieverId = spanAttributes.retrieverId;
      break;
    case "rag.recipe":
      runtimeJoin.primitive = "retrieval.recipe";
      spanAttributes.recipeId = id.slice("rag.recipe:".length);
      runtimeJoin.recipeId = spanAttributes.recipeId;
      break;
    case "rag.pipeline":
      runtimeJoin.primitive = "rag.pipeline";
      spanAttributes.ragPipelineId = id.slice("rag.pipeline:".length);
      runtimeJoin.ragPipelineId = spanAttributes.ragPipelineId;
      break;
    case "workspace":
      runtimeJoin.primitive = "workspace.operation";
      spanAttributes.workspaceId = id.slice("workspace:".length);
      runtimeJoin.workspaceId = spanAttributes.workspaceId;
      break;
  }

  return { runtimeJoin };
}

/** Removes a index id prefix when deriving runtime join names from definition ids. */
function stripDefinitionPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
