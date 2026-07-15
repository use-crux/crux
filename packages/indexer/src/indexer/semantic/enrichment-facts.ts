import type {
  InjectionReturnContributionFacts,
  InjectionToolFacts,
  InjectionUseFacts,
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { foldedIndexChild } from "../index-presentation";
import { safeId } from "../definitions";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
  SemanticMemoryBlock,
  SemanticTarget,
} from "./candidates";
import { semanticNodeKey } from "./syntax-readers";
import {
  callExpressionName,
  isResolvableSourceExpression,
  objectMemberExpression,
  propertyInitializer,
  resolveSemanticExpression,
  semanticArrayExpression,
  semanticArrayProperty,
  semanticFallbackModelExpressions,
  semanticDefinitionPatchBase,
  semanticExpressionToJsonSchema,
  semanticObjectProperty,
  semanticObjectPropertyName,
  semanticObjectExpression,
  semanticRelation,
  semanticResolvedKey,
  semanticResolvedSourceRef,
  semanticRoutingTargetSourceRef,
  semanticSchemaSourceRef,
  semanticStringLiteralProperty,
  semanticTargetForExpression,
  semanticToolMapTargets,
  toExpression,
  unwrapExpression,
} from "./model";
import { semanticStorageDefinitionEnrichments } from "./storage-facts";
import { routingContextFactsForCallback } from "./routing-context";
import {
  compactWorkspaceMountMetadata,
  compactWorkspaceMountSourceMetadata,
  RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES,
  RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER,
  WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES,
  type WorkspaceMountMetadata,
  type WorkspaceMountSourceMetadata,
} from "./workspace-mount-metadata";

type SemanticNode = SemanticAnalyzerNode<SemanticAnalyzerView>;

/**
 * Produces semantic definition enrichments that cannot be represented by the
 * first static definition pass.
 *
 * Enrichments are pure patch facts: callers receive new definition/source-ref
 * values for routing children, memory blocks, and workspace resources while the
 * original candidate and AST remain unchanged.
 */
export function semanticDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  switch (candidate.kind) {
    case "memory":
      return semanticMemoryDefinitionEnrichments(candidate, view);
    case "workspace":
      return [
        ...semanticWorkspaceDefinitionEnrichments(candidate, view),
        ...semanticStorageDefinitionEnrichments(candidate, view),
      ];
    case "rag.retriever":
    case "storage.recordStore":
    case "storage.vectorStore":
    case "storage.assetStore":
    case "storage.bundle":
    case "storage.scope":
      return semanticStorageDefinitionEnrichments(candidate, view);
    case "routing.router":
      return semanticRouterDefinitionEnrichments(candidate, view);
    case "routing.split":
      return semanticSplitDefinitionEnrichments(candidate, view);
    case "routing.retry":
      return semanticRetryDefinitionEnrichments(candidate, view);
    case "routing.cascade":
      return semanticCascadeDefinitionEnrichments(candidate, view);
    case "routing.fallback":
      return semanticFallbackDefinitionEnrichments(candidate, view);
    case "prompt":
    case "context":
    case "injectable":
      return semanticInjectionDefinitionEnrichments(candidate, view);
    default:
      return [];
  }
}

/** Builds folded route definitions and target source refs from split routes. */
function semanticSplitDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const parent = semanticRoutingParentEnrichment(candidate, "seed", view);
  const routes = semanticObjectProperty(candidate.object, "routes", view);
  if (!routes) return parent;
  return [
    ...parent,
    ...view.syntax.objectProperties(routes).flatMap((property, index) => {
      const routeKey = semanticObjectPropertyName(property, view);
      const expression = objectMemberExpression(property, view);
      if (!routeKey || !expression) return [];
      const target = semanticTargetForExpression(expression, view);
      const ref = semanticRoutingTargetSourceRef(
        `${candidate.definitionId}:route:${safeId(routeKey)}`,
        "routes",
        expression,
        view,
      );
      const definition = semanticRoutingChildPatch(
        `${candidate.definitionId}:route:${safeId(routeKey)}`,
        "routing.split.route",
        routeKey,
        target,
        index,
        semanticRoutingCallProfile(expression, view),
      );
      return ref
        ? [{ definition, sourceRefs: [ref] }]
        : target
          ? [{ definition }]
          : [];
    }),
  ];
}

/** Builds the folded target definition and source ref for retry. */
function semanticRetryDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  if (!candidate.call) return [];
  const [model] = view.syntax.callArguments(candidate.call);
  if (!model) return [];
  const definitionId = `${candidate.definitionId}:target:1`;
  const target = semanticTargetForExpression(model, view);
  const ref = semanticRoutingTargetSourceRef(
    definitionId,
    "model",
    model,
    view,
  );
  const definition = semanticRoutingChildPatch(
    definitionId,
    "routing.retry.target",
    "target",
    target,
    0,
  );
  return ref
    ? [{ definition, sourceRefs: [ref] }]
    : target
      ? [{ definition }]
      : [];
}

function semanticInjectionDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const useEntries = semanticInjectionUseEntryFacts(candidate, view);
  const tools = semanticInjectionToolFacts(candidate, view);
  const contributions = semanticInjectionReturnContributionFacts(
    candidate,
    view,
  );
  if (useEntries.length === 0 && !tools && !contributions) return [];
  return [
    {
      definition: {
        ...semanticDefinitionPatchBase(candidate),
        metadata: {
          facts: {
            kind: candidate.kind,
            ...(useEntries.length > 0 ? { useEntries } : {}),
            ...(tools ? { tools } : {}),
            ...(contributions ? { contributions } : {}),
          },
        },
      },
    },
  ];
}

/**
 * Adds resolved `useEntries` for import-safe arrays and spread entries that the
 * static pass can only describe as an unresolved array variable.
 */
export function semanticInjectionUseEntryFacts(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): InjectionUseFacts[] {
  const use = propertyInitializer(candidate.object, "use", view);
  return use
    ? semanticInjectionUseEntries(toExpression(use, view), candidate.kind, view)
    : [];
}

function semanticInjectionToolFacts(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): InjectionToolFacts | undefined {
  const expressions: SemanticNode[] = [];
  const tools = propertyInitializer(candidate.object, "tools", view);
  if (tools) expressions.push(toExpression(tools, view));
  if (candidate.kind === "injectable") {
    const returned = semanticInjectableReturnObject(candidate, view);
    const returnedTools = returned
      ? propertyInitializer(returned, "tools", view)
      : undefined;
    if (returnedTools) expressions.push(toExpression(returnedTools, view));
  }
  return mergeSemanticToolFacts(
    expressions.map((expression) =>
      semanticToolFactsFromExpression(expression, view),
    ),
  );
}

function semanticInjectionReturnContributionFacts(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): InjectionReturnContributionFacts | undefined {
  if (candidate.kind !== "injectable") return undefined;
  const returned = semanticInjectableReturnObject(candidate, view);
  if (!returned) return undefined;
  const constraints = semanticReferenceContributionFacts(
    returned,
    "constraints",
    "constraint",
    view,
  );
  const guardrails = semanticReferenceContributionFacts(
    returned,
    "guardrails",
    "guardrail",
    view,
  );
  const metadata = semanticMetadataContributionFacts(returned, view);
  const facts: InjectionReturnContributionFacts = {};
  if (constraints) facts.constraints = constraints;
  if (guardrails) facts.guardrails = guardrails;
  if (metadata) facts.metadata = metadata;
  return Object.keys(facts).length > 0 ? facts : undefined;
}

function semanticInjectionUseEntries(
  expression: SemanticNode,
  ownerKind: SemanticDefinitionCandidate["kind"],
  view: SemanticAnalyzerView,
): InjectionUseFacts[] {
  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "arrayLiteral")) {
    return view.syntax.arrayElements(unwrapped).flatMap((element) => {
      const spread = view.syntax.spreadExpression(element);
      if (spread) {
        return semanticInjectionUseEntriesFromExpression(
          spread,
          ownerKind,
          view,
          {
            conditionality: "unknown",
            via: "spread",
          },
        );
      }
      return semanticInjectionUseEntriesFromExpression(
        element,
        ownerKind,
        view,
        {
          conditionality: "always",
          via: "direct",
        },
      );
    });
  }
  return semanticInjectionUseEntriesFromExpression(unwrapped, ownerKind, view, {
    conditionality: "always",
    via: "array-ref",
  });
}

type SemanticInjectionUseContext = Required<
  Pick<InjectionUseFacts, "conditionality" | "via">
> &
  Pick<InjectionUseFacts, "branch">;

function semanticInjectionUseEntriesFromExpression(
  expression: SemanticNode,
  ownerKind: SemanticDefinitionCandidate["kind"],
  view: SemanticAnalyzerView,
  context: SemanticInjectionUseContext,
  seen = new Set<string>(),
): InjectionUseFacts[] {
  const unwrapped = unwrapExpression(expression, view);
  const key = semanticNodeKey(unwrapped, view.syntax);
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const helperEntries = semanticConditionalHelperUseEntries(
      unwrapped,
      ownerKind,
      view,
      context,
      nextSeen,
    );
    if (helperEntries) return helperEntries;
  }
  const logicalAnd = view.syntax.logicalAndOperands(unwrapped);
  if (logicalAnd) {
    return semanticInjectionUseEntriesFromExpression(
      logicalAnd.right,
      ownerKind,
      view,
      { conditionality: "binary-guard", via: "binary", branch: context.branch },
      nextSeen,
    );
  }
  const array = semanticArrayExpression(unwrapped, view, nextSeen);
  if (array) {
    return view.syntax.arrayElements(array).flatMap((element) => {
      const spread = view.syntax.spreadExpression(element);
      if (spread) {
        return semanticInjectionUseEntriesFromExpression(
          spread,
          ownerKind,
          view,
          {
            conditionality:
              context.conditionality === "always"
                ? "unknown"
                : context.conditionality,
            via: "spread",
            branch: context.branch,
          },
          nextSeen,
        );
      }
      return semanticInjectionUseEntriesFromExpression(
        element,
        ownerKind,
        view,
        context,
        nextSeen,
      );
    });
  }
  return semanticInjectionUseEntryForTarget(
    unwrapped,
    ownerKind,
    view,
    context,
  );
}

function semanticConditionalHelperUseEntries(
  call: SemanticNode,
  ownerKind: SemanticDefinitionCandidate["kind"],
  view: SemanticAnalyzerView,
  context: SemanticInjectionUseContext,
  seen: Set<string>,
): InjectionUseFacts[] | undefined {
  const callName = callExpressionName(call, view);
  const args = view.syntax.callArguments(call);
  if (callName === "when" && args[1]) {
    return semanticInjectionUseEntriesFromExpression(
      args[1],
      ownerKind,
      view,
      { conditionality: "when", via: "when", branch: context.branch },
      seen,
    );
  }
  if (callName === "match" && args[0]) {
    const object = semanticObjectExpression(args[0], view, seen);
    return object ? semanticMatchUseEntries(object, ownerKind, view, seen) : [];
  }
  return undefined;
}

function semanticMatchUseEntries(
  object: SemanticNode,
  ownerKind: SemanticDefinitionCandidate["kind"],
  view: SemanticAnalyzerView,
  seen: Set<string>,
): InjectionUseFacts[] {
  const cases = semanticObjectProperty(object, "cases", view);
  const defaults = propertyInitializer(object, "default", view);
  const caseEntries = cases
    ? view.syntax
        .objectProperties(cases)
        .flatMap((property): InjectionUseFacts[] => {
          const branch = semanticObjectPropertyName(property, view);
          const expression = view.syntax.propertyInitializer(property);
          if (!expression) return [];
          return semanticInjectionUseEntriesFromExpression(
            expression,
            ownerKind,
            view,
            { conditionality: "match-case", via: "match", branch },
            seen,
          );
        })
    : [];
  const defaultEntries = defaults
    ? semanticInjectionUseEntriesFromExpression(
        toExpression(defaults, view),
        ownerKind,
        view,
        { conditionality: "match-default", via: "match", branch: "default" },
        seen,
      )
    : [];
  return [...caseEntries, ...defaultEntries];
}

function semanticInjectionUseEntryForTarget(
  expression: SemanticNode,
  ownerKind: SemanticDefinitionCandidate["kind"],
  view: SemanticAnalyzerView,
  context: SemanticInjectionUseContext,
): InjectionUseFacts[] {
  const target = semanticTargetForExpression(expression, view);
  const relationType = target
    ? semanticInjectionUseEntryRelationType(ownerKind, target.kind)
    : undefined;
  if (!target || !relationType)
    return [semanticUnresolvedUseEntry(expression, context, view)];
  return [
    {
      variable: semanticUseEntryVariable(expression, target, view),
      relationHint: semanticRelationHintForTarget(target.kind),
      targetDefinitionId: target.id,
      targetKind: target.kind,
      targetName: target.id.split(":").at(-1) ?? target.id,
      relationType,
      relationFidelity: "resolved",
      conditionality: context.conditionality,
      via: context.via,
      ...(context.branch ? { branch: context.branch } : {}),
    },
  ];
}

function semanticUnresolvedUseEntry(
  expression: SemanticNode,
  context: SemanticInjectionUseContext,
  view: SemanticAnalyzerView,
): InjectionUseFacts {
  const variable = semanticExpressionVariable(expression, view);
  return {
    ...(variable ? { variable } : {}),
    relationHint: "unknown",
    conditionality: isDynamicSemanticUseExpression(expression, view)
      ? "dynamic"
      : context.conditionality === "always"
        ? "unknown"
        : context.conditionality,
    via: context.via,
    ...(context.branch ? { branch: context.branch } : {}),
  };
}

function isDynamicSemanticUseExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): boolean {
  const unwrapped = unwrapExpression(expression, view);
  const key = semanticNodeKey(unwrapped, view.syntax);
  if (seen.has(key)) return false;
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  if (
    view.syntax.isKind(unwrapped, "callExpression") ||
    view.syntax.isKind(unwrapped, "elementAccessExpression") ||
    view.syntax.kind(unwrapped) === "unknown"
  ) {
    return true;
  }
  if (!isResolvableSourceExpression(unwrapped, view)) return false;
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? isDynamicSemanticUseExpression(resolved.expression, view, nextSeen)
    : false;
}

function semanticExpressionVariable(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
): string | undefined {
  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "identifier"))
    return view.syntax.identifierText(unwrapped);
  if (view.syntax.isKind(unwrapped, "callExpression"))
    return callExpressionName(unwrapped, view) ?? view.syntax.text(unwrapped);
  if (view.syntax.isKind(unwrapped, "propertyAccessExpression"))
    return view.syntax.propertyAccessName(unwrapped);
  return undefined;
}

function semanticUseEntryVariable(
  expression: SemanticNode,
  target: SemanticTarget,
  view: SemanticAnalyzerView,
): string {
  const unwrapped = unwrapExpression(expression, view);
  const identifier = view.syntax.identifierText(unwrapped);
  if (identifier) return identifier;
  return target.id.split(":").at(-1) ?? target.id;
}

function semanticInjectionUseEntryRelationType(
  ownerKind: SemanticDefinitionCandidate["kind"],
  targetKind: ProjectDefinitionKind,
): string | undefined {
  if (
    ownerKind !== "prompt" &&
    ownerKind !== "context" &&
    ownerKind !== "injectable"
  )
    return undefined;
  switch (targetKind) {
    case "context":
      return `${ownerKind}.uses_context`;
    case "injectable":
      if (ownerKind === "injectable") return undefined;
      return `${ownerKind}.uses_injectable`;
    case "memory":
      return `${ownerKind}.uses_memory`;
    case "blackboard":
      return `${ownerKind}.uses_blackboard`;
    case "mcp.server":
      if (ownerKind === "injectable") return undefined;
      return `${ownerKind}.uses_mcp_server`;
    default:
      return undefined;
  }
}

function semanticRelationHintForTarget(
  kind: ProjectDefinitionKind,
): InjectionUseFacts["relationHint"] {
  switch (kind) {
    case "context":
    case "injectable":
    case "memory":
    case "blackboard":
      return kind;
    default:
      return "unknown";
  }
}

function semanticToolFactsFromExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): InjectionToolFacts {
  const object = semanticObjectExpression(expression, view, seen);
  if (!object) {
    const targets = semanticToolMapTargets(expression, view, seen);
    if (targets.length > 0) {
      const names = targets.map(
        (target) => target.id.split(":").at(-1) ?? target.id,
      );
      return { hasTools: true, names, variables: names };
    }
    return { hasTools: true, dynamic: true };
  }
  const names: string[] = [];
  const variables: string[] = [];
  let dynamic = false;
  for (const property of view.syntax.objectProperties(object)) {
    const spread = view.syntax.spreadExpression(property);
    if (spread) {
      const spreadFacts = semanticToolFactsFromExpression(spread, view, seen);
      dynamic = dynamic || Boolean(spreadFacts.dynamic);
      names.push(...(spreadFacts.names ?? []));
      variables.push(...(spreadFacts.variables ?? []));
      continue;
    }
    const name = semanticObjectPropertyName(property, view);
    const member = objectMemberExpression(property, view);
    if (name) names.push(name);
    if (!member) continue;
    const target = semanticTargetForExpression(member, view);
    if (target?.kind === "tool") {
      variables.push(target.id.split(":").at(-1) ?? target.id);
      continue;
    }
    const variable = semanticExpressionVariable(member, view);
    if (variable) variables.push(variable);
    if (!variable && !target) dynamic = true;
  }
  return {
    hasTools: true,
    ...(dynamic ? { dynamic } : {}),
    ...(names.length > 0 ? { names: [...new Set(names)] } : {}),
    ...(variables.length > 0 ? { variables: [...new Set(variables)] } : {}),
  };
}

function mergeSemanticToolFacts(
  facts: readonly InjectionToolFacts[],
): InjectionToolFacts | undefined {
  if (facts.length === 0) return undefined;
  const names = [...new Set(facts.flatMap((fact) => fact.names ?? []))];
  const variables = [...new Set(facts.flatMap((fact) => fact.variables ?? []))];
  return {
    hasTools: true,
    ...(facts.some((fact) => fact.dynamic) ? { dynamic: true } : {}),
    ...(names.length > 0 ? { names } : {}),
    ...(variables.length > 0 ? { variables } : {}),
  };
}

function semanticReferenceContributionFacts(
  object: SemanticNode,
  property: string,
  targetKind: ProjectDefinitionKind,
  view: SemanticAnalyzerView,
): NonNullable<InjectionReturnContributionFacts["constraints"]> | undefined {
  const expression = propertyInitializer(object, property, view);
  if (!expression) return undefined;
  const contribution = semanticReferenceContributionFromExpression(
    toExpression(expression, view),
    targetKind,
    view,
  );
  if (contribution.variables.length === 0 && !contribution.dynamic)
    return undefined;
  return {
    ...(contribution.variables.length > 0
      ? { variables: [...new Set(contribution.variables)] }
      : {}),
    ...(contribution.dynamic ? { dynamic: true } : {}),
  };
}

function semanticReferenceContributionFromExpression(
  expression: SemanticNode,
  targetKind: ProjectDefinitionKind,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): { readonly variables: string[]; readonly dynamic: boolean } {
  const unwrapped = unwrapExpression(expression, view);
  const key = semanticNodeKey(unwrapped, view.syntax);
  if (seen.has(key)) return { variables: [], dynamic: true };
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  const array = semanticArrayExpression(unwrapped, view, nextSeen);
  if (array) {
    const variables: string[] = [];
    let dynamic = false;
    for (const element of view.syntax.arrayElements(array)) {
      const spreadExpression = view.syntax.spreadExpression(element);
      if (spreadExpression) {
        const spread = semanticReferenceContributionFromExpression(
          spreadExpression,
          targetKind,
          view,
          nextSeen,
        );
        variables.push(...spread.variables);
        dynamic = dynamic || spread.dynamic;
        continue;
      }
      const entry = semanticReferenceContributionFromExpression(
        element,
        targetKind,
        view,
        nextSeen,
      );
      variables.push(...entry.variables);
      dynamic = dynamic || entry.dynamic;
    }
    return { variables, dynamic };
  }
  const target = semanticTargetForExpression(unwrapped, view);
  if (target?.kind === targetKind) {
    return {
      variables: [
        semanticExpressionVariable(unwrapped, view) ??
          target.id.split(":").at(-1) ??
          target.id,
      ],
      dynamic: false,
    };
  }
  const variable = semanticExpressionVariable(unwrapped, view);
  return {
    variables: variable ? [variable] : [],
    dynamic: isDynamicSemanticUseExpression(unwrapped, view, nextSeen),
  };
}

function semanticMetadataContributionFacts(
  object: SemanticNode,
  view: SemanticAnalyzerView,
): NonNullable<InjectionReturnContributionFacts["metadata"]> | undefined {
  const expression = propertyInitializer(object, "metadata", view);
  if (!expression) return undefined;
  const contribution = semanticMetadataContributionFromExpression(
    toExpression(expression, view),
    view,
  );
  if (contribution.keys.length === 0 && !contribution.dynamic) return undefined;
  return {
    ...(contribution.keys.length > 0
      ? { keys: [...new Set(contribution.keys)] }
      : {}),
    ...(contribution.dynamic ? { dynamic: true } : {}),
  };
}

function semanticMetadataContributionFromExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): { readonly keys: string[]; readonly dynamic: boolean } {
  const object = semanticObjectExpression(expression, view, seen);
  if (!object) return { keys: [], dynamic: true };
  const keys: string[] = [];
  let dynamic = false;
  for (const property of view.syntax.objectProperties(object)) {
    const spreadExpression = view.syntax.spreadExpression(property);
    if (spreadExpression) {
      const spread = semanticMetadataContributionFromExpression(
        spreadExpression,
        view,
        seen,
      );
      keys.push(...spread.keys);
      dynamic = dynamic || true;
      continue;
    }
    const key = semanticObjectPropertyName(property, view);
    if (key) keys.push(key);
    if (!key) dynamic = true;
  }
  return { keys, dynamic };
}

function semanticInjectableReturnObject(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticNode | undefined {
  const inject = propertyInitializer(candidate.object, "inject", view);
  return inject
    ? semanticReturnedObjectExpression(toExpression(inject, view), view)
    : undefined;
}

function semanticReturnedObjectExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticNode | undefined {
  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "objectLiteral")) return unwrapped;
  const returned = semanticReturnedObjectFromFunction(unwrapped, view);
  if (returned) return returned;
  const resolved = resolveSemanticExpression(unwrapped, view);
  if (!resolved) return undefined;
  const key = semanticResolvedKey(resolved);
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  if (resolved.expression)
    return semanticReturnedObjectExpression(
      resolved.expression,
      view,
      nextSeen,
    );
  return semanticReturnedObjectFromFunction(resolved.declaration, view);
}

function semanticReturnedObjectFromFunction(
  node: SemanticNode,
  view: SemanticAnalyzerView,
): SemanticNode | undefined {
  for (const expression of view.syntax.functionReturnExpressions(node)) {
    const returned = semanticReturnedObjectFromExpression(expression, view);
    if (returned) return returned;
  }
  return undefined;
}

function semanticReturnedObjectFromExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
): SemanticNode | undefined {
  const unwrapped = unwrapExpression(expression, view);
  return view.syntax.isKind(unwrapped, "objectLiteral") ? unwrapped : undefined;
}

/**
 * Builds folded route definitions and target source refs from router routes.
 */
function semanticRouterDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const parent = semanticRoutingParentEnrichment(candidate, "classify", view);
  const routes = semanticObjectProperty(candidate.object, "routes", view);
  if (!routes) return parent;
  return [
    ...parent,
    ...view.syntax.objectProperties(routes).flatMap((property, index) => {
      const routeKey = semanticObjectPropertyName(property, view);
      const expression = objectMemberExpression(property, view);
      if (!routeKey || !expression) return [];
      const target = semanticTargetForExpression(expression, view);
      const ref = semanticRoutingTargetSourceRef(
        `${candidate.definitionId}:route:${safeId(routeKey)}`,
        "routes",
        expression,
        view,
      );
      return ref
        ? [
            {
              definition: semanticRoutingChildPatch(
                `${candidate.definitionId}:route:${safeId(routeKey)}`,
                "routing.router.route",
                routeKey,
                target,
                index,
                semanticRoutingCallProfile(expression, view),
              ),
              sourceRefs: [ref],
            },
          ]
        : target
          ? [
              {
                definition: semanticRoutingChildPatch(
                  `${candidate.definitionId}:route:${safeId(routeKey)}`,
                  "routing.router.route",
                  routeKey,
                  target,
                  index,
                  semanticRoutingCallProfile(expression, view),
                ),
              },
            ]
          : [];
    }),
  ];
}

/** Creates a semantic parent patch for router and split context metadata. */
function semanticRoutingParentEnrichment(
  candidate: SemanticDefinitionCandidate,
  property: "classify" | "seed",
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const callback = propertyInitializer(candidate.object, property, view);
  const context = callback
    ? routingContextFactsForCallback(toExpression(callback, view), view)
    : undefined;
  return [
    {
      definition: {
        ...semanticDefinitionPatchBase(candidate),
        metadata: {
          facts: {
            kind: candidate.kind,
            ...(context ?? {}),
          },
        },
      },
    },
  ];
}

/**
 * Builds folded tier definitions plus model/evaluate source refs from cascade
 * tiers.
 */
function semanticCascadeDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const tiers = semanticArrayProperty(candidate.object, "tiers", view);
  if (!tiers) return [];
  return view.syntax.arrayElements(tiers).flatMap((element, index) => {
    const tier = unwrapExpression(element, view);
    if (!view.syntax.isKind(tier, "objectLiteral")) return [];
    const definitionId = `${candidate.definitionId}:tier:${index + 1}`;
    const sourceRefs: ProjectSourceRef[] = [];
    const model = propertyInitializer(tier, "model", view);
    const target = model ? semanticTargetForExpression(model, view) : undefined;
    const targetRef = model
      ? semanticRoutingTargetSourceRef(definitionId, "model", model, view)
      : undefined;
    if (targetRef) sourceRefs.push(targetRef);
    const evaluate = propertyInitializer(tier, "evaluate", view);
    const evaluateRef = evaluate
      ? semanticResolvedSourceRef(
          definitionId,
          "evaluate",
          "callback",
          evaluate,
          view,
        )
      : undefined;
    if (evaluateRef) sourceRefs.push(evaluateRef);
    return sourceRefs.length > 0
      ? [
          {
            definition: semanticRoutingChildPatch(
              definitionId,
              "routing.cascade.tier",
              `tier ${index + 1}`,
              target,
              index,
            ),
            sourceRefs,
          },
        ]
      : target
        ? [
            {
              definition: semanticRoutingChildPatch(
                definitionId,
                "routing.cascade.tier",
                `tier ${index + 1}`,
                target,
                index,
              ),
            },
          ]
        : [];
  });
}

/**
 * Builds folded option definitions and target source refs from fallback
 * alternatives.
 */
function semanticFallbackDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  if (!candidate.call) return [];
  return semanticFallbackModelExpressions(candidate.call, view).flatMap(
    (argument, index) => {
      const definitionId = `${candidate.definitionId}:option:${index + 1}`;
      const target = semanticTargetForExpression(argument, view);
      const ref = semanticRoutingTargetSourceRef(
        definitionId,
        "model",
        argument,
        view,
      );
      return ref
        ? [
            {
              definition: semanticRoutingChildPatch(
                definitionId,
                "routing.fallback.option",
                `option ${index + 1}`,
                target,
                index,
              ),
              sourceRefs: [ref],
            },
          ]
        : target
          ? [
              {
                definition: semanticRoutingChildPatch(
                  definitionId,
                  "routing.fallback.option",
                  `option ${index + 1}`,
                  target,
                  index,
                ),
              },
            ]
          : [];
    },
  );
}

/**
 * Creates the shared Project Index patch for folded routing child definitions.
 */
function semanticRoutingChildPatch(
  id: string,
  kind: Extract<
    ProjectDefinitionKind,
    | "routing.router.route"
    | "routing.split.route"
    | "routing.retry.target"
    | "routing.cascade.tier"
    | "routing.fallback.option"
  >,
  name: string,
  target?: SemanticTarget,
  order?: number,
  profile?: Record<string, unknown>,
): ProjectDefinition {
  const presentation = semanticRoutingChildPresentation(id, kind, order);
  return {
    id,
    kind,
    name,
    fidelity: "resolved",
    status: "active",
    metadata: {
      indexPresentation: presentation,
      ...(target
        ? { targetKind: target.kind, targetDefinitionId: target.id }
        : {}),
      ...(profile ? { profile, facts: { kind, profile } } : {}),
    },
  };
}

/** Reads JSON-safe literal call-profile settings without treating `model` as a setting. */
function semanticRoutingCallProfile(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
): Record<string, unknown> | undefined {
  const route = semanticObjectExpression(expression, view, new Set());
  if (!route) return undefined;
  const profile = Object.fromEntries(
    view.syntax.objectProperties(route).flatMap((property) => {
      const name = semanticObjectPropertyName(property, view);
      const initializer = view.syntax.propertyInitializer(property);
      if (!name || name === "model" || !initializer) return [];
      const value = semanticRoutingJsonValue(initializer, view);
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return Object.keys(profile).length > 0 ? profile : undefined;
}

function semanticRoutingJsonValue(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
): unknown {
  const value = unwrapExpression(expression, view);
  const literal = view.syntax.literalValue(value);
  if (literal !== undefined) return literal;
  if (view.syntax.isKind(value, "arrayLiteral")) {
    const items = view.syntax
      .arrayElements(value)
      .map((item) => semanticRoutingJsonValue(item, view));
    return items.some((item) => item === undefined) ? undefined : items;
  }
  if (!view.syntax.isKind(value, "objectLiteral")) return undefined;
  const entries: Array<readonly [string, unknown]> = [];
  for (const property of view.syntax.objectProperties(value)) {
    const name = semanticObjectPropertyName(property, view);
    const initializer = view.syntax.propertyInitializer(property);
    if (!name || !initializer) return undefined;
    const nested = semanticRoutingJsonValue(initializer, view);
    if (nested === undefined) return undefined;
    entries.push([name, nested]);
  }
  return Object.fromEntries(entries);
}

/**
 * Computes folded-child presentation metadata for a routing child id/kind pair.
 */
function semanticRoutingChildPresentation(
  id: string,
  kind: Extract<
    ProjectDefinitionKind,
    | "routing.router.route"
    | "routing.split.route"
    | "routing.retry.target"
    | "routing.cascade.tier"
    | "routing.fallback.option"
  >,
  order?: number,
) {
  if (kind === "routing.router.route") {
    return foldedIndexChild({
      parentDefinitionId: id.split(":route:")[0],
      parentRelationType: "router.includes_route",
      role: "route",
      order,
    });
  }
  if (kind === "routing.cascade.tier") {
    return foldedIndexChild({
      parentDefinitionId: id.split(":tier:")[0],
      parentRelationType: "cascade.includes_tier",
      role: "tier",
      order,
    });
  }
  if (kind === "routing.split.route") {
    return foldedIndexChild({
      parentDefinitionId: id.split(":route:")[0],
      parentRelationType: "split.includes_route",
      role: "route",
      order,
    });
  }
  if (kind === "routing.retry.target") {
    return foldedIndexChild({
      parentDefinitionId: id.split(":target:")[0],
      parentRelationType: "retry.uses_target",
      role: "option",
      order,
    });
  }
  return foldedIndexChild({
    parentDefinitionId: id.split(":option:")[0],
    parentRelationType: "fallback.includes_option",
    role: "option",
    order,
  });
}

/**
 * Builds memory block child definitions, schema refs, and memory-block
 * membership relations.
 */
function semanticMemoryDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const blocksExpression = propertyInitializer(
    candidate.object,
    "blocks",
    view,
  );
  if (!blocksExpression) return [];
  const blocks = semanticArrayExpression(blocksExpression, view, new Set());
  if (!blocks) return [];

  const blockMetadata: Array<Record<string, unknown>> = [];
  const enrichments: SemanticDefinitionEnrichment[] = [];
  const relations: ProjectRelation[] = [];

  for (const [index, element] of view.syntax.arrayElements(blocks).entries()) {
    const block = semanticMemoryBlockForExpression(element, view);
    if (!block) continue;
    const blockId = block.id ?? block.kind ?? "block";
    const definitionId = `memory.block:${safeId(candidate.name)}:${safeId(blockId)}`;
    const sourceRefs =
      block.schemaResolved && block.schemaExpression
        ? [
            semanticSchemaSourceRef(
              {
                definitionId,
                kind: "memory.block",
                name: blockId,
                object: block.object,
                property: "schema",
                metadataKey: "schema",
                expression: block.schemaExpression,
              },
              block.schemaResolved,
              Boolean(block.schema),
              view,
            ),
          ]
        : [];
    const metadata = {
      memoryId: candidate.definitionId,
      blockId: block.id,
      blockKind: block.kind,
      indexPresentation: foldedIndexChild({
        parentDefinitionId: candidate.definitionId,
        parentRelationType: "memory.includes_block",
        role: "block",
        order: index,
      }),
      schema: block.schema,
    };
    blockMetadata.push({
      id: block.id,
      kind: block.kind,
      schema: block.schema,
    });
    enrichments.push({
      definition: {
        id: definitionId,
        kind: "memory.block",
        name: blockId,
        fidelity: "resolved",
        status: "active",
        metadata,
      },
      sourceRefs,
    });
    relations.push(
      semanticRelation(
        candidate,
        "memory.includes_block",
        candidate.definitionId,
        definitionId,
        view,
      ),
    );
  }

  if (blockMetadata.length === 0) return [];
  const schemas = blockMetadata
    .map((block) => block.schema)
    .filter((schema): schema is JsonSchema => Boolean(schema));
  const workingSchemas = blockMetadata
    .filter((block) => block.kind === "working" && block.schema)
    .map((block) => block.schema)
    .filter((schema): schema is JsonSchema => Boolean(schema));
  enrichments.unshift({
    definition: {
      ...semanticDefinitionPatchBase(candidate),
      metadata: {
        blocks: blockMetadata,
        blockCount: blockMetadata.length,
        schema:
          workingSchemas.length === 1
            ? workingSchemas[0]
            : schemas.length === 1
              ? schemas[0]
              : undefined,
      },
    },
    relations,
  });
  return enrichments;
}

/**
 * Resolves a memory block expression, following identifiers to reusable block
 * declarations with cycle protection.
 */
function semanticMemoryBlockForExpression(
  expression: SemanticNode,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticMemoryBlock | undefined {
  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "callExpression"))
    return semanticMemoryBlockForCall(unwrapped, view);
  if (!isResolvableSourceExpression(unwrapped, view)) return undefined;
  const resolved = resolveSemanticExpression(unwrapped, view);
  if (!resolved?.expression) return undefined;
  const key = semanticResolvedKey(resolved);
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  return semanticMemoryBlockForExpression(resolved.expression, view, nextSeen);
}

/**
 * Extracts memory block metadata from a known block factory call.
 */
function semanticMemoryBlockForCall(
  call: SemanticNode,
  view: SemanticAnalyzerView,
): SemanticMemoryBlock | undefined {
  const callName = callExpressionName(call, view);
  const [firstArg] = view.syntax.callArguments(call);
  if (!firstArg || !view.syntax.isKind(firstArg, "objectLiteral"))
    return undefined;
  const kind = semanticMemoryBlockKindForCall(callName, firstArg, view);
  if (!kind) return undefined;
  const schemaExpression = propertyInitializer(firstArg, "schema", view);
  const resolvedSchema = schemaExpression
    ? resolveSemanticExpression(schemaExpression, view)
    : undefined;
  const schema = resolvedSchema
    ? semanticExpressionToJsonSchema(resolvedSchema, view)
    : undefined;
  return {
    id: semanticStringLiteralProperty(firstArg, "id", view),
    kind,
    schema,
    schemaExpression,
    schemaResolved: resolvedSchema,
    object: firstArg,
  };
}

/**
 * Maps a block factory call name to the normalized memory block kind.
 */
function semanticMemoryBlockKindForCall(
  callName: string | undefined,
  object: SemanticNode,
  view: SemanticAnalyzerView,
): string | undefined {
  switch (callName) {
    case "workingState":
      return "working";
    case "recentMessages":
      return "recent";
    case "episodes":
      return "episodes";
    case "facts":
      return "facts";
    case "procedures":
      return "procedures";
    case "reflections":
      return "reflections";
    case "memoryBlock":
      return semanticStringLiteralProperty(object, "kind", view) ?? "custom";
    default:
      return undefined;
  }
}

/**
 * Projects workspace mount metadata and mount-path relations from authored
 * workspace config.
 */
function semanticWorkspaceDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  const mountsExpression = propertyInitializer(
    candidate.object,
    "mounts",
    view,
  );
  if (!mountsExpression) return [];
  const mounts = semanticArrayExpression(mountsExpression, view, new Set());
  if (!mounts) return [];
  const metadata = view.syntax
    .arrayElements(mounts)
    .map((element) => unwrapExpression(element, view))
    .filter((element) => view.syntax.isKind(element, "objectLiteral"))
    .map((mount) =>
      compactWorkspaceMountMetadata({
        path: semanticStringLiteralProperty(mount, "path", view),
        access: semanticStringLiteralProperty(mount, "access", view),
        description: semanticStringLiteralProperty(mount, "description", view),
        source: semanticWorkspaceMountSourceMetadata(mount, view),
      }),
    )
    .filter((mount): mount is WorkspaceMountMetadata => mount !== undefined);
  if (metadata.length === 0) return [];
  return [
    {
      definition: {
        ...semanticDefinitionPatchBase(candidate),
        metadata: {
          mounts: metadata,
        },
      },
      relations: metadata.flatMap((mount) =>
        mount.path
          ? [
              semanticRelation(
                candidate,
                "workspace.mounts_path",
                candidate.definitionId,
                `workspace.path:${safeId(candidate.name)}:${safeId(mount.path)}`,
                view,
              ),
            ]
          : [],
      ),
    },
  ];
}

/**
 * Reads source-backed workspace mount metadata from semantically resolved mount config.
 *
 * The enrichment uses backend-neutral syntax only so TypeScript and native semantic backends emit the
 * same provider summary without exposing executable provider values.
 */
function semanticWorkspaceMountSourceMetadata(
  mount: SemanticNode,
  view: SemanticAnalyzerView,
): WorkspaceMountSourceMetadata | undefined {
  const sourceExpression = propertyInitializer(mount, "source", view);
  if (!sourceExpression) return undefined;
  const expression = toExpression(sourceExpression, view);
  const sourceObject = semanticObjectExpression(expression, view, new Set());
  if (sourceObject)
    return semanticWorkspaceMountObjectSourceMetadata(sourceObject, view);

  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const helper = callExpressionName(unwrapped, view);
    if (helper === RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER) {
      return {
        kind: "retriever",
        helper: RETRIEVER_WORKSPACE_MOUNT_SOURCE_HELPER,
        capabilities: RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES,
      };
    }
    return compactWorkspaceMountSourceMetadata({
      kind: helper ? "custom" : "unknown",
      helper,
    });
  }

  const reference = semanticExpressionVariable(unwrapped, view);
  return compactWorkspaceMountSourceMetadata({
    kind: reference ? "custom" : "unknown",
    reference,
  });
}

function semanticWorkspaceMountObjectSourceMetadata(
  source: SemanticNode,
  view: SemanticAnalyzerView,
): WorkspaceMountSourceMetadata | undefined {
  const kind = semanticStringLiteralProperty(source, "kind", view) ?? "custom";
  return compactWorkspaceMountSourceMetadata({
    kind,
    retriever: semanticReferenceProperty(source, "retriever", view),
    capabilities: semanticWorkspaceMountSourceCapabilities(source, kind, view),
  });
}

function semanticWorkspaceMountSourceCapabilities(
  source: SemanticNode,
  kind: string,
  view: SemanticAnalyzerView,
): readonly string[] | undefined {
  if (kind === "retriever")
    return RETRIEVER_WORKSPACE_MOUNT_SOURCE_CAPABILITIES;
  const capabilities = WORKSPACE_MOUNT_SOURCE_CAPABILITY_PROPERTIES.filter(
    (property) => Boolean(propertyInitializer(source, property, view)),
  );
  return capabilities.length > 0 ? capabilities : undefined;
}

function semanticReferenceProperty(
  object: SemanticNode,
  name: string,
  view: SemanticAnalyzerView,
): string | undefined {
  const expression = propertyInitializer(object, name, view);
  return expression
    ? semanticExpressionVariable(toExpression(expression, view), view)
    : undefined;
}
