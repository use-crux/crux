import type { ProjectRelation } from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import {
  semanticCallbackAccessRelations,
  semanticFlowAccessRelations,
} from "./access-relations";
import { semanticAgentHandoffRelations } from "./agent-handoff-relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "./candidates";
import {
  arrayProperty,
  arrayPropertyExpressions,
  branchRelationType,
  callExpressionName,
  compositionRelationType,
  flowStepRelationType,
  isRoutingTargetKind,
  objectMemberExpression,
  objectProperty,
  propertyExpressions,
  propertyInitializer,
  resolveSemanticExpression,
  routingTargetRelationType,
  semanticArrayExpression,
  semanticArrayProperty,
  semanticFallbackModelExpressions,
  semanticObjectProperty,
  semanticObjectPropertyName,
  semanticRelation,
  semanticTargetForExpression,
  semanticToolMapTargets,
  toExpression,
  unwrapExpression,
} from "./model";
import { semanticStorageRelationsForCandidate } from "./storage-facts";
import {
  semanticNodeKey,
  semanticStringLiteralProperty,
} from "./syntax-readers";

/**
 * Computes resolved semantic relations for one discovered definition.
 *
 * The function is a pure dispatcher over candidate kind: it reads compiler
 * symbols through the provided type view and returns fresh relation values,
 * leaving AST nodes and candidate objects untouched.
 */
export function semanticRelationsForCandidate(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const accessRelations = semanticCallbackAccessRelations(candidate, view);
  switch (candidate.kind) {
    case "prompt":
    case "context":
    case "injectable":
      return [
        ...semanticInjectionUseRelations(candidate, view),
        ...semanticInjectionToolRelations(candidate, view),
        ...accessRelations,
      ];
    case "tool":
      return accessRelations;
    case "agent":
      return [...semanticAgentRelations(candidate, view), ...accessRelations];
    case "flow":
      return [
        ...semanticFlowRelations(candidate, view),
        ...semanticFlowAccessRelations(candidate, view),
      ];
    case "composition.parallel":
    case "composition.pipeline":
    case "composition.swarm":
    case "composition.consensus":
      return semanticCompositionRelations(candidate, view);
    case "rag.recipe":
      return semanticRetrievalRecipeRelations(candidate, view);
    case "routing.router":
      return [...semanticRouterRelations(candidate, view), ...accessRelations];
    case "routing.split":
      return [...semanticSplitRelations(candidate, view), ...accessRelations];
    case "routing.retry":
      return semanticRetryRelations(candidate, view);
    case "routing.cascade":
      return semanticCascadeRelations(candidate, view);
    case "routing.fallback":
      return [
        ...semanticFallbackRelations(candidate, view),
        ...accessRelations,
      ];
    case "rag.retriever":
    case "workspace":
    case "storage.bundle":
    case "storage.scope":
      return semanticStorageRelationsForCandidate(candidate, view);
    case "constraint":
    case "guardrail":
      return semanticSafetyRelations(candidate, view);
    default:
      return [];
  }
}

/**
 * Resolves static and import-safe `use` arrays into injection relations.
 */
function semanticInjectionUseRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const use = propertyInitializer(candidate.object, "use", view);
  if (!use) return [];
  const expressions = semanticUseExpressions(toExpression(use, view), view);
  const relations: ProjectRelation[] = [];
  expressions.forEach((expression, index) => {
    const target = semanticTargetForExpression(expression, view);
    const type = target
      ? semanticInjectionUseRelationType(candidate.kind, target.kind)
      : undefined;
    if (!target || !type) return;
    relations.push(
      semanticRelation(
        candidate,
        type,
        `${candidate.definitionId}:use:${index + 1}`,
        target.id,
        view,
      ),
    );
  });
  return relations;
}

/**
 * Reads elements from a use expression, following import-safe array constants
 * and spread entries without executing code.
 */
function semanticUseExpressions(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticAnalyzerNode<SemanticAnalyzerView>[] {
  const key = semanticNodeKey(expression, view.syntax);
  if (seen.has(key)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  const array = semanticArrayExpression(expression, view, nextSeen);
  if (!array) return [expression];
  const expressions: SemanticAnalyzerNode<SemanticAnalyzerView>[] = [];
  for (const element of view.syntax.arrayElements(array)) {
    const spread = view.syntax.spreadExpression(element);
    if (spread) {
      expressions.push(...semanticUseExpressions(spread, view, nextSeen));
      continue;
    }
    expressions.push(element);
  }
  return expressions;
}

/**
 * Maps prompt/context/injectable use targets to Project Index relation names.
 */
function semanticInjectionUseRelationType(
  ownerKind: SemanticDefinitionCandidate["kind"],
  targetKind: string,
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
    default:
      return undefined;
  }
}

/**
 * Resolves import-safe tool maps on prompt/context configs and simple injectable
 * return objects into tool relations.
 */
function semanticInjectionToolRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const expressions: SemanticAnalyzerNode<SemanticAnalyzerView>[] = [];
  const tools = propertyInitializer(candidate.object, "tools", view);
  if (tools) expressions.push(toExpression(tools, view));
  if (candidate.kind === "injectable") {
    const returned = semanticInjectableReturnObject(candidate, view);
    const returnedTools = returned
      ? propertyInitializer(returned, "tools", view)
      : undefined;
    if (returnedTools) expressions.push(toExpression(returnedTools, view));
  }
  const type = `${candidate.kind}.uses_tool`;
  const relations: ProjectRelation[] = [];
  const seenTargets = new Set<string>();
  for (const expression of expressions) {
    for (const target of semanticToolMapTargets(expression, view)) {
      const key = `${type}:${target.id}`;
      if (seenTargets.has(key)) continue;
      seenTargets.add(key);
      relations.push(
        semanticRelation(
          candidate,
          type,
          candidate.definitionId,
          target.id,
          view,
        ),
      );
    }
  }
  return relations;
}

/**
 * Reads a simple object returned by an injectable `inject` callback without
 * executing the callback.
 */
function semanticInjectableReturnObject(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const inject = propertyInitializer(candidate.object, "inject", view);
  return inject
    ? semanticReturnedObjectExpression(toExpression(inject, view), view)
    : undefined;
}

function semanticReturnedObjectExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen = new Set<string>(),
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = unwrapExpression(expression, view);
  if (view.syntax.isKind(unwrapped, "objectLiteral")) return unwrapped;
  for (const returned of view.syntax.functionReturnExpressions(unwrapped)) {
    const object = semanticReturnedObjectFromExpression(returned, view);
    if (object) return object;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  if (!resolved) return undefined;
  const key = `${resolved.sourceFile.fileName}:${resolved.declaration.pos}:${resolved.declaration.end}:${resolved.symbol}`;
  if (seen.has(key)) return undefined;
  const nextSeen = new Set(seen);
  nextSeen.add(key);
  if (resolved.expression)
    return semanticReturnedObjectExpression(
      resolved.expression,
      view,
      nextSeen,
    );
  for (const returned of view.syntax.functionReturnExpressions(
    resolved.declaration,
  )) {
    const object = semanticReturnedObjectFromExpression(returned, view);
    if (object) return object;
  }
  return undefined;
}

function semanticReturnedObjectFromExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = unwrapExpression(expression, view);
  return view.syntax.isKind(unwrapped, "objectLiteral") ? unwrapped : undefined;
}

/**
 * Resolves router route entries into route-child target relations.
 */
function semanticRouterRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const routes = semanticObjectProperty(candidate.object, "routes", view);
  if (!routes) return [];
  const relations: ProjectRelation[] = [];
  for (const property of view.syntax.objectProperties(routes)) {
    const routeKey = semanticObjectPropertyName(property, view);
    const expression = objectMemberExpression(property, view);
    if (!routeKey || !expression) continue;
    const target = semanticTargetForExpression(expression, view);
    const type = target
      ? routingTargetRelationType("router.route", target.kind)
      : undefined;
    if (!target || !type) continue;
    relations.push(
      semanticRelation(
        candidate,
        type,
        `${candidate.definitionId}:route:${safeId(routeKey)}`,
        target.id,
        view,
      ),
    );
  }
  return relations;
}

/** Resolves split route entries into weighted route-child target relations. */
function semanticSplitRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const routes = semanticObjectProperty(candidate.object, "routes", view);
  if (!routes) return [];
  const relations: ProjectRelation[] = [];
  for (const property of view.syntax.objectProperties(routes)) {
    const routeKey = semanticObjectPropertyName(property, view);
    const expression = objectMemberExpression(property, view);
    if (!routeKey || !expression) continue;
    const target = semanticTargetForExpression(expression, view);
    const type = target
      ? routingTargetRelationType("split.route", target.kind)
      : undefined;
    if (!target || !type) continue;
    relations.push(
      semanticRelation(
        candidate,
        type,
        `${candidate.definitionId}:route:${safeId(routeKey)}`,
        target.id,
        view,
      ),
    );
  }
  return relations;
}

/** Resolves the wrapped retry target. */
function semanticRetryRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  if (!candidate.call) return [];
  const [model] = view.syntax.callArguments(candidate.call);
  const target = model ? semanticTargetForExpression(model, view) : undefined;
  const type = target
    ? routingTargetRelationType("retry.target", target.kind)
    : undefined;
  return target && type
    ? [
        semanticRelation(
          candidate,
          type,
          `${candidate.definitionId}:target:1`,
          target.id,
          view,
        ),
      ]
    : [];
}

/**
 * Resolves cascade tier models into tier-child target relations.
 */
function semanticCascadeRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const tiers = semanticArrayProperty(candidate.object, "tiers", view);
  if (!tiers) return [];
  const relations: ProjectRelation[] = [];
  view.syntax.arrayElements(tiers).forEach((element, index) => {
    if (!view.syntax.isKind(element, "objectLiteral")) return;
    const model = propertyInitializer(element, "model", view);
    if (!model) return;
    const target = semanticTargetForExpression(model, view);
    const type = target
      ? routingTargetRelationType("cascade.tier", target.kind)
      : undefined;
    if (!target || !type) return;
    relations.push(
      semanticRelation(
        candidate,
        type,
        `${candidate.definitionId}:tier:${index + 1}`,
        target.id,
        view,
      ),
    );
  });
  return relations;
}

/**
 * Resolves fallback positional model arguments into option-child target relations.
 */
function semanticFallbackRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  if (!candidate.call) return [];
  const relations: ProjectRelation[] = [];
  semanticFallbackModelExpressions(candidate.call, view).forEach(
    (argument, index) => {
      const target = semanticTargetForExpression(argument, view);
      const type = target
        ? routingTargetRelationType("fallback.option", target.kind)
        : undefined;
      if (!target || !type) return;
      relations.push(
        semanticRelation(
          candidate,
          type,
          `${candidate.definitionId}:option:${index + 1}`,
          target.id,
          view,
        ),
      );
    },
  );
  return relations;
}

/**
 * Resolves agent dependencies declared through prompt, model/languageModel, and
 * tools config properties.
 */
function semanticAgentRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const relations: ProjectRelation[] = [];
  const prompt = propertyInitializer(candidate.object, "prompt", view);
  const promptTarget = prompt
    ? semanticTargetForExpression(prompt, view)
    : undefined;
  if (promptTarget?.kind === "prompt") {
    relations.push(
      semanticRelation(
        candidate,
        "agent.uses_prompt",
        candidate.definitionId,
        promptTarget.id,
        view,
      ),
    );
  }

  for (const property of ["model", "languageModel"] as const) {
    const model = propertyInitializer(candidate.object, property, view);
    const modelTarget = model
      ? semanticTargetForExpression(model, view)
      : undefined;
    if (modelTarget && isRoutingTargetKind(modelTarget.kind)) {
      relations.push(
        semanticRelation(
          candidate,
          "agent.uses_routing",
          candidate.definitionId,
          modelTarget.id,
          view,
        ),
      );
    }
  }

  const tools = propertyInitializer(candidate.object, "tools", view);
  if (tools) {
    for (const target of semanticToolMapTargets(
      toExpression(tools, view),
      view,
    )) {
      relations.push(
        semanticRelation(
          candidate,
          "agent.uses_tool",
          candidate.definitionId,
          target.id,
          view,
        ),
      );
    }
  }
  relations.push(...semanticAgentHandoffRelations(candidate, view));
  return relations;
}

/**
 * Resolves `flow.step(label, target)` calls inside a flow handler.
 */
function semanticFlowRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const handler = propertyInitializer(candidate.object, "handler", view);
  if (!handler) return [];
  const relations: ProjectRelation[] = [];
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>): void => {
    if (view.syntax.isKind(node, "callExpression")) {
      const targetExpression = view.syntax.callExpressionTarget(node);
      if (
        targetExpression &&
        view.syntax.propertyAccessName(targetExpression) === "step"
      ) {
        const [stepArg, targetArg] = view.syntax.callArguments(node);
        const stepName = stepArg
          ? view.syntax.stringLiteralText(stepArg)
          : undefined;
        if (stepName && targetArg) {
          const target = semanticTargetForExpression(targetArg, view);
          const type = target ? flowStepRelationType(target.kind) : undefined;
          if (target && type) {
            relations.push(
              semanticRelation(
                candidate,
                type,
                `flow.step:${safeId(candidate.name)}:${safeId(stepName)}`,
                target.id,
                view,
              ),
            );
          }
        }
      }
    }
    view.syntax.children(node).forEach(visit);
  };
  visit(handler);
  return relations;
}

/**
 * Dispatches relation extraction for the supported composition families.
 */
function semanticCompositionRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  switch (candidate.kind) {
    case "composition.parallel":
      return semanticParallelRelations(candidate, view);
    case "composition.pipeline":
      return semanticPipelineRelations(candidate, view);
    case "composition.consensus":
      return semanticConsensusRelations(candidate, view);
    case "composition.swarm":
      return semanticSwarmRelations(candidate, view);
    default:
      return [];
  }
}

/**
 * Resolves parallel composition branches and their aggregate target relations.
 */
function semanticParallelRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const agents = objectProperty(candidate.object, "agents", view);
  if (!agents) return [];
  const relations: ProjectRelation[] = [];
  for (const property of view.syntax.objectProperties(agents)) {
    const branchId = semanticObjectPropertyName(property, view);
    const expression = objectMemberExpression(property, view);
    if (!branchId || !expression) continue;
    const target = semanticTargetForExpression(expression, view);
    if (!target) continue;
    const compositionType = compositionRelationType(target.kind);
    const branchType = branchRelationType("parallel", target.kind);
    if (compositionType)
      relations.push(
        semanticRelation(
          candidate,
          compositionType,
          candidate.definitionId,
          target.id,
          view,
        ),
      );
    if (branchType) {
      relations.push(
        semanticRelation(
          candidate,
          branchType,
          `${candidate.definitionId}:branch:${safeId(branchId)}`,
          target.id,
          view,
        ),
      );
    }
  }
  return relations;
}

/**
 * Resolves pipeline stages and their aggregate target relations.
 */
function semanticPipelineRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const steps = arrayProperty(candidate.object, "steps", view);
  if (!steps) return [];
  const relations: ProjectRelation[] = [];
  view.syntax.arrayElements(steps).forEach((element, index) => {
    if (!view.syntax.isKind(element, "objectLiteral")) return;
    const stageName =
      semanticStringLiteralProperty(element, "name", view.syntax) ??
      `stage-${index + 1}`;
    for (const property of ["agent", "flow", "prompt", "tool"] as const) {
      const expression = propertyInitializer(element, property, view);
      if (!expression) continue;
      const target = semanticTargetForExpression(expression, view);
      if (!target) continue;
      const compositionType = compositionRelationType(target.kind);
      const stageType = branchRelationType("pipeline", target.kind);
      if (compositionType)
        relations.push(
          semanticRelation(
            candidate,
            compositionType,
            candidate.definitionId,
            target.id,
            view,
          ),
        );
      if (stageType) {
        relations.push(
          semanticRelation(
            candidate,
            stageType,
            `${candidate.definitionId}:stage:${safeId(stageName)}`,
            target.id,
            view,
          ),
        );
      }
    }
  });
  return relations;
}

/**
 * Resolves retrieval recipe source and step dependencies.
 */
function semanticRetrievalRecipeRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const relations: ProjectRelation[] = [];
  const retriever = propertyInitializer(candidate.object, "retriever", view);
  const retrieverTarget = retriever
    ? semanticTargetForExpression(retriever, view)
    : undefined;
  if (retrieverTarget?.kind === "rag.retriever") {
    relations.push(
      semanticRelation(
        candidate,
        "rag.recipe.uses_retriever",
        candidate.definitionId,
        retrieverTarget.id,
        view,
      ),
    );
  }

  const steps = arrayProperty(candidate.object, "steps", view);
  if (!steps) return relations;
  view.syntax.arrayElements(steps).forEach((element, index) => {
    const step = retrievalRecipeStepObject(element, view);
    if (!step) return;
    const { object: stepObject, callName } = step;
    const stepName =
      semanticStringLiteralProperty(stepObject, "id", view.syntax) ??
      semanticStringLiteralProperty(stepObject, "name", view.syntax) ??
      callName ??
      `step-${index + 1}`;
    const stepId = `${candidate.definitionId}:step:${safeId(stepName)}`;
    relations.push(
      semanticRelation(
        candidate,
        "rag.recipe.includes_step",
        candidate.definitionId,
        stepId,
        view,
      ),
    );

    const stepRetriever = propertyInitializer(stepObject, "retriever", view);
    const stepRetrieverTarget = stepRetriever
      ? semanticTargetForExpression(stepRetriever, view)
      : undefined;
    if (stepRetrieverTarget?.kind === "rag.retriever") {
      relations.push(
        semanticRelation(
          candidate,
          "rag.recipe.step.uses_retriever",
          stepId,
          stepRetrieverTarget.id,
          view,
        ),
      );
    }

    for (const property of ["scorer", "judge"] as const) {
      const scorer = propertyInitializer(stepObject, property, view);
      const scorerTarget = scorer
        ? semanticTargetForExpression(scorer, view)
        : undefined;
      if (scorerTarget?.kind === "scorer") {
        relations.push(
          semanticRelation(
            candidate,
            "rag.recipe.step.uses_scorer",
            stepId,
            scorerTarget.id,
            view,
          ),
        );
      }
    }
    for (const property of ["engine", "reranker"] as const) {
      const reranker = propertyInitializer(stepObject, property, view);
      const rerankerTarget = reranker
        ? semanticTargetForExpression(reranker, view)
        : undefined;
      if (rerankerTarget?.kind === "rag.reranker") {
        relations.push(
          semanticRelation(
            candidate,
            "rag.recipe.step.uses_reranker",
            stepId,
            rerankerTarget.id,
            view,
          ),
        );
      }
    }
  });
  return relations;
}

function retrievalRecipeStepObject(
  element: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
):
  | {
      readonly object: SemanticAnalyzerNode<SemanticAnalyzerView>;
      readonly callName?: string;
    }
  | undefined {
  if (view.syntax.isKind(element, "objectLiteral")) return { object: element };
  if (!view.syntax.isKind(element, "callExpression")) return undefined;
  const callName = callExpressionName(element, view);
  if (!callName) return undefined;
  const [firstArg] = view.syntax.callArguments(element);
  if (!firstArg || !view.syntax.isKind(firstArg, "objectLiteral"))
    return undefined;
  return { object: firstArg, callName };
}

/**
 * Resolves consensus participants plus judge and scorer dependencies.
 */
function semanticConsensusRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const relations: ProjectRelation[] = [];
  for (const expression of arrayPropertyExpressions(
    candidate.object,
    "agents",
    view,
  )) {
    const target = semanticTargetForExpression(expression, view);
    if (target?.kind !== "agent") continue;
    relations.push(
      semanticRelation(
        candidate,
        "composition.uses_agent",
        candidate.definitionId,
        target.id,
        view,
      ),
    );
    relations.push(
      semanticRelation(
        candidate,
        "consensus.includes_agent",
        candidate.definitionId,
        target.id,
        view,
      ),
    );
  }
  const judge = propertyInitializer(candidate.object, "judge", view);
  const judgeTarget = judge
    ? semanticTargetForExpression(judge, view)
    : undefined;
  if (judgeTarget?.kind === "agent" || judgeTarget?.kind === "scorer") {
    relations.push(
      semanticRelation(
        candidate,
        "consensus.uses_judge",
        candidate.definitionId,
        judgeTarget.id,
        view,
      ),
    );
  }
  const scorer = propertyInitializer(candidate.object, "scorer", view);
  const scorerTarget = scorer
    ? semanticTargetForExpression(scorer, view)
    : undefined;
  if (scorerTarget?.kind === "scorer") {
    relations.push(
      semanticRelation(
        candidate,
        "consensus.uses_scorer",
        candidate.definitionId,
        scorerTarget.id,
        view,
      ),
    );
  }
  return relations;
}

/**
 * Resolves swarm participants plus coordinator state-resource dependencies.
 */
function semanticSwarmRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const relations: ProjectRelation[] = [];
  const agents = objectProperty(candidate.object, "agents", view);
  if (agents) {
    for (const property of view.syntax.objectProperties(agents)) {
      const expression = objectMemberExpression(property, view);
      if (!expression) continue;
      const target = semanticTargetForExpression(expression, view);
      if (target?.kind !== "agent") continue;
      relations.push(
        semanticRelation(
          candidate,
          "composition.uses_agent",
          candidate.definitionId,
          target.id,
          view,
        ),
      );
      relations.push(
        semanticRelation(
          candidate,
          "swarm.includes_agent",
          candidate.definitionId,
          target.id,
          view,
        ),
      );
    }
  }
  const blackboard = propertyInitializer(candidate.object, "blackboard", view);
  const blackboardTarget = blackboard
    ? semanticTargetForExpression(blackboard, view)
    : undefined;
  if (blackboardTarget?.kind === "blackboard") {
    relations.push(
      semanticRelation(
        candidate,
        "swarm.uses_blackboard",
        candidate.definitionId,
        blackboardTarget.id,
        view,
      ),
    );
  }
  for (const expression of propertyInitializer(candidate.object, "memory", view)
    ? propertyExpressions(candidate.object, "memory", view)
    : []) {
    const target = semanticTargetForExpression(expression, view);
    if (target?.kind === "memory")
      relations.push(
        semanticRelation(
          candidate,
          "swarm.uses_memory",
          candidate.definitionId,
          target.id,
          view,
        ),
      );
  }
  return relations;
}

/**
 * Resolves constraint/guardrail target declarations into safety relations.
 */
function semanticSafetyRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const relationType =
    candidate.kind === "constraint"
      ? "constraint.applies_to"
      : "guardrail.applies_to";
  const relations: ProjectRelation[] = [];
  for (const property of ["appliesTo", "target", "targets", "for"] as const) {
    for (const expression of propertyExpressions(
      candidate.object,
      property,
      view,
    )) {
      const target = semanticTargetForExpression(expression, view);
      if (target)
        relations.push(
          semanticRelation(
            candidate,
            relationType,
            candidate.definitionId,
            target.id,
            view,
          ),
        );
    }
  }
  return relations;
}
