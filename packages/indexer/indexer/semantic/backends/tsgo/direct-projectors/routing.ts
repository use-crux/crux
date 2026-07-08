import { foldedIndexChild } from "../../../../index-presentation";
import { projectRelation } from "../../../../relations";
import { safeId } from "../../../../definitions";
import type {
  ProjectDefinitionIndexPresentationRole,
  ProjectDefinitionKind,
  ProjectRelation,
} from "@use-crux/core/project-index";
import {
  isCallExpression,
  isArrayLiteralExpression,
  isObjectLiteralExpression,
  type Expression,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
} from "@typescript/native-preview/unstable/ast";
import { nativeNodeList, nativeSourceForNode } from "../source";
import { propertyInitializer } from "./object";
import {
  arrayPropertyExpression,
  objectPropertyExpression,
  propertyExpression,
  propertyNameForRoutingMember,
  sourceRefForExpression,
  targetForExpression,
} from "./routing-expressions";
import type {
  DefinitionFact,
  NativeDefinition,
  NativeSourceBinding,
  RelationFact,
  SourceRefFact,
} from "./types";

/** Direct-native semantic facts owned by routing child projection. */
export interface NativeRoutingEvidence {
  readonly definitions: readonly DefinitionFact[];
  readonly relations: readonly RelationFact[];
  readonly sourceRefs: readonly SourceRefFact[];
}

type RoutingChildKind = Extract<
  ProjectDefinitionKind,
  | "routing.router.route"
  | "routing.split.route"
  | "routing.retry.target"
  | "routing.cascade.tier"
  | "routing.fallback.option"
>;
type RoutingOwner =
  | "router.route"
  | "split.route"
  | "retry.target"
  | "cascade.tier"
  | "fallback.option";

interface RoutingChildInput {
  readonly id: string;
  readonly kind: RoutingChildKind;
  readonly name: string;
  readonly owner: RoutingOwner;
  readonly parentId: string;
  readonly order: number;
  readonly property: string;
  readonly expression: Expression;
}

/** Emits semantic routing child facts directly from native AST evidence. */
export function routingEvidenceForDefinition(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  if (definition.kind === "routing.router")
    return routerEvidence(definition, definitions, bindings);
  if (definition.kind === "routing.split")
    return splitEvidence(definition, definitions, bindings);
  if (definition.kind === "routing.retry")
    return retryEvidence(definition, definitions, bindings);
  if (definition.kind === "routing.cascade")
    return cascadeEvidence(definition, definitions, bindings);
  if (definition.kind === "routing.fallback")
    return fallbackEvidence(definition, definitions, bindings);
  return emptyRoutingEvidence();
}

function splitEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  const routes = objectPropertyExpression(
    definition.object,
    "routes",
    bindings,
  );
  if (routes === "unsupported") return undefined;
  if (!routes) return emptyRoutingEvidence();
  return mergeRoutingEvidence(
    presentValues(
      nativeNodeList(routes.properties).map((property, index) =>
        splitRouteEvidence(definition, definitions, bindings, property, index),
      ),
    ),
  );
}

function retryEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  const call = definition.variable.initializer;
  if (!isCallExpression(call)) return undefined;
  const [model] = nativeNodeList(call.arguments);
  if (!model) return emptyRoutingEvidence();
  return mergeRoutingEvidence([
    routingChildEvidence(definition, definitions, bindings, {
      id: `${definition.id}:target:1`,
      kind: "routing.retry.target",
      name: "target",
      owner: "retry.target",
      parentId: definition.id,
      order: 0,
      property: "model",
      expression: model,
    }) ?? [],
  ]);
}

function routerEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  const routes = objectPropertyExpression(
    definition.object,
    "routes",
    bindings,
  );
  if (routes === "unsupported") return undefined;
  if (!routes) return emptyRoutingEvidence();
  return mergeRoutingEvidence(
    presentValues(
      nativeNodeList(routes.properties).map((property, index) =>
        routerRouteEvidence(definition, definitions, bindings, property, index),
      ),
    ),
  );
}

function cascadeEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  const tiers = arrayPropertyExpression(definition.object, "tiers", bindings);
  if (tiers === "unsupported") return undefined;
  if (!tiers) return emptyRoutingEvidence();
  return mergeRoutingEvidence(
    presentValues(
      nativeNodeList(tiers.elements).map((element, index) =>
        isObjectLiteralExpression(element)
          ? cascadeTierEvidence(
              definition,
              definitions,
              bindings,
              element,
              index,
            )
          : [],
      ),
    ),
  );
}

function fallbackEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): NativeRoutingEvidence | undefined {
  const call = definition.variable.initializer;
  if (!isCallExpression(call)) return undefined;
  const args = nativeNodeList(call.arguments);
  const modelArgs = fallbackModelExpressions(args, definition.object);
  return mergeRoutingEvidence(
    presentValues(
      modelArgs.map((argument, index) =>
        routingChildEvidence(definition, definitions, bindings, {
          id: `${definition.id}:option:${index + 1}`,
          kind: "routing.fallback.option",
          name: `option ${index + 1}`,
          owner: "fallback.option",
          parentId: definition.id,
          order: index,
          property: "model",
          expression: argument,
        }),
      ),
    ),
  );
}

function fallbackModelExpressions(
  args: readonly Expression[],
  options: ObjectLiteralExpression,
): readonly Expression[] {
  const modelArgs = args.filter((argument) => argument !== options);
  const [first] = modelArgs;
  return first && isArrayLiteralExpression(first)
    ? nativeNodeList(first.elements)
    : modelArgs;
}

function routerRouteEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  property: ObjectLiteralElementLike,
  index: number,
): readonly NativeRoutingEvidence[] | undefined {
  const routeKey = propertyNameForRoutingMember(property);
  const expression = propertyExpression(property);
  return routeKey && expression
    ? routingChildEvidence(definition, definitions, bindings, {
        id: `${definition.id}:route:${safeId(routeKey)}`,
        kind: "routing.router.route",
        name: routeKey,
        owner: "router.route",
        parentId: definition.id,
        order: index,
        property: "routes",
        expression,
      })
    : [];
}

function splitRouteEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  property: ObjectLiteralElementLike,
  index: number,
): readonly NativeRoutingEvidence[] | undefined {
  const routeKey = propertyNameForRoutingMember(property);
  const expression = propertyExpression(property);
  return routeKey && expression
    ? routingChildEvidence(definition, definitions, bindings, {
        id: `${definition.id}:route:${safeId(routeKey)}`,
        kind: "routing.split.route",
        name: routeKey,
        owner: "split.route",
        parentId: definition.id,
        order: index,
        property: "routes",
        expression,
      })
    : [];
}

function cascadeTierEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  tier: ObjectLiteralExpression,
  index: number,
): readonly NativeRoutingEvidence[] | undefined {
  const model = propertyInitializer(tier, "model");
  if (!model) return [];
  const targetEvidence = routingChildEvidence(
    definition,
    definitions,
    bindings,
    {
      id: `${definition.id}:tier:${index + 1}`,
      kind: "routing.cascade.tier",
      name: `tier ${index + 1}`,
      owner: "cascade.tier",
      parentId: definition.id,
      order: index,
      property: "model",
      expression: model,
    },
  );
  const evaluate = propertyInitializer(tier, "evaluate");
  const evaluateRef = evaluate
    ? sourceRefForExpression(
        `${definition.id}:tier:${index + 1}`,
        "callback",
        "evaluate",
        evaluate,
        bindings,
      )
    : undefined;
  if (evaluateRef === "unsupported" || !targetEvidence) return undefined;
  if (!evaluateRef) return targetEvidence;
  return targetEvidence.length > 0
    ? [
        {
          definitions: targetEvidence.flatMap((entry) => entry.definitions),
          relations: targetEvidence.flatMap((entry) => entry.relations),
          sourceRefs: [
            ...targetEvidence.flatMap((entry) => entry.sourceRefs),
            evaluateRef,
          ],
        },
      ]
    : [];
}

function routingChildEvidence(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
  input: RoutingChildInput,
): readonly NativeRoutingEvidence[] | undefined {
  const target = targetForExpression(input.expression, definitions, bindings);
  const sourceRef = sourceRefForExpression(
    input.id,
    "config",
    input.property,
    input.expression,
    bindings,
    {
      routingTarget: true,
    },
  );
  if (target === "unsupported" || sourceRef === "unsupported") return undefined;
  if (!target && !sourceRef) return [];
  return [
    {
      definitions: [routingChildDefinition(input, target)],
      relations: target
        ? relationForRoutingTarget(definition, input, target)
        : [],
      sourceRefs: sourceRef ? [sourceRef] : [],
    },
  ];
}

function routingChildDefinition(
  input: RoutingChildInput,
  target: NativeDefinition | undefined,
): DefinitionFact {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    fidelity: "resolved",
    status: "active",
    metadata: {
      indexPresentation: foldedIndexChild({
        parentDefinitionId: input.parentId,
        parentRelationType: parentRelationType(input.owner),
        role: routingChildRole(input.owner),
        order: input.order,
      }),
      ...(target
        ? { targetKind: target.kind, targetDefinitionId: target.id }
        : {}),
    },
    sourceRefs: [],
  };
}

function relationForRoutingTarget(
  definition: NativeDefinition,
  input: RoutingChildInput,
  target: NativeDefinition,
): readonly RelationFact[] {
  const type = routingTargetRelationType(input.owner, target.kind);
  return type
    ? [
        projectRelation({
          type,
          from: input.id,
          to: target.id,
          fidelity: "resolved",
          source: nativeSourceForNode(
            definition.variable.file,
            definition.object,
          ),
        }),
      ]
    : [];
}

function routingTargetRelationType(
  owner: RoutingOwner,
  targetKind: ProjectDefinitionKind,
): ProjectRelation["type"] | undefined {
  const target = routingRelationTargetName(targetKind);
  return target ? `${owner}.uses_${target}` : undefined;
}

function routingRelationTargetName(
  kind: ProjectDefinitionKind,
): string | undefined {
  if (kind === "routing.router") return "router";
  if (kind === "routing.split") return "split";
  if (kind === "routing.retry") return "retry";
  if (kind === "routing.cascade") return "cascade";
  if (kind === "routing.fallback") return "fallback";
  if (kind === "agent") return "agent";
  if (kind === "prompt") return "prompt";
  return undefined;
}

function parentRelationType(owner: RoutingOwner): string {
  if (owner === "router.route") return "router.includes_route";
  if (owner === "split.route") return "split.includes_route";
  if (owner === "retry.target") return "retry.uses_target";
  if (owner === "cascade.tier") return "cascade.includes_tier";
  return "fallback.includes_option";
}

function routingChildRole(
  owner: RoutingOwner,
): ProjectDefinitionIndexPresentationRole {
  if (owner === "router.route") return "route";
  if (owner === "split.route") return "route";
  if (owner === "retry.target") return "option";
  if (owner === "cascade.tier") return "tier";
  return "option";
}

function mergeRoutingEvidence(
  values: readonly (readonly NativeRoutingEvidence[])[] | undefined,
): NativeRoutingEvidence | undefined {
  return values
    ? {
        definitions: values.flatMap((group) =>
          group.flatMap((value) => value.definitions),
        ),
        relations: values.flatMap((group) =>
          group.flatMap((value) => value.relations),
        ),
        sourceRefs: values.flatMap((group) =>
          group.flatMap((value) => value.sourceRefs),
        ),
      }
    : undefined;
}

function emptyRoutingEvidence(): NativeRoutingEvidence {
  return { definitions: [], relations: [], sourceRefs: [] };
}

function presentValues<TValue>(
  values: readonly (TValue | undefined)[],
): readonly TValue[] | undefined {
  return values.every((value): value is TValue => value !== undefined)
    ? values
    : undefined;
}
