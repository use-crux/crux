/**
 * Backend-neutral Project Index evidence for authored context planning.
 *
 * @module
 */

import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
} from "../candidates";
import { semanticDefinitionCandidates } from "../discovery";
import { semanticArrayProperty, semanticObjectProperty } from "../model";
import {
  semanticPropertyInitializer,
  semanticPropertyName,
  semanticSourceForNode,
} from "../syntax-readers";
import { historyCardinalityFinding, invalidWrapperOrderFinding } from "./lints";
import {
  canonicalHistoryKind,
  contextPlanningWrapperAnalysis,
} from "./wrappers";
import { semanticContextPlanningOverrides } from "./overrides";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

export interface SemanticContextPlanningFacts {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly lintFindings: readonly IndexLintFinding[];
}

/** Project safe planning structure from every semantic definition candidate. */
export function semanticContextPlanningFacts<
  TView extends SemanticAnalyzerView,
>(
  sourceFiles: readonly SemanticAnalyzerSourceFile<TView>[],
  view: TView,
): SemanticContextPlanningFacts {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: Array<{
    definitionId: string;
    ref: ProjectSourceRef;
  }> = [];
  const lintFindings: IndexLintFinding[] = [];
  const overrides = semanticContextPlanningOverrides(sourceFiles, view);

  for (const sourceFile of sourceFiles) {
    for (const candidate of semanticDefinitionCandidates(
      sourceFile,
      view.syntax,
    )) {
      const projected = projectCandidate(candidate, view);
      const invocation = overrides.get(candidate.definitionId);
      const contextPlanning = {
        ...(projected.facts ?? {}),
        ...(invocation ? { overrides: invocation.counts } : {}),
      };
      if (Object.keys(contextPlanning).length > 0) {
        definitions.push({
          id: candidate.definitionId,
          kind: candidate.kind,
          name: candidate.name,
          fidelity: "resolved",
          status: "active",
          metadata: {
            facts: {
              kind: candidate.kind,
              contextPlanning,
            },
          },
        });
      }
      sourceRefs.push(
        ...[...projected.refs, ...(invocation?.refs ?? [])].map((ref) => ({
          definitionId: candidate.definitionId,
          ref,
        })),
      );
      lintFindings.push(...projected.findings);
    }
  }

  return {
    definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
    sourceRefs: sourceRefs.sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    lintFindings: lintFindings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function projectCandidate(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): {
  readonly facts?: Readonly<Record<string, unknown>>;
  readonly refs: readonly ProjectSourceRef[];
  readonly findings: readonly IndexLintFinding[];
} {
  const facts: Record<string, unknown> = {};
  const refs: ProjectSourceRef[] = [];
  const findings: IndexLintFinding[] = [];

  if (candidate.kind === "prompt" || candidate.kind === "context") {
    projectUse(candidate, view, facts, findings);
  }
  if (candidate.kind === "agent") {
    const budget = inputBudgetFact(candidate.object, view);
    if (budget) facts.inputBudget = budget;
    addPropertyRef(candidate, "inputBudget", "config", view, refs);
    addHook(candidate, "prepareStep", view, facts, refs);
  }
  if (
    candidate.kind === "composition.parallel" ||
    candidate.kind === "composition.pipeline" ||
    candidate.kind === "composition.swarm" ||
    candidate.kind === "composition.consensus"
  ) {
    addHook(candidate, "prepareInvocation", view, facts, refs);
  }

  return {
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
    refs,
    findings,
  };
}

function projectUse(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
  facts: Record<string, unknown>,
  findings: IndexLintFinding[],
): void {
  const use = semanticArrayProperty(candidate.object, "use", view);
  if (!use) return;
  const history = { managed: 0, recent: 0 };
  const contributions: Array<Readonly<Record<string, unknown>>> = [];
  let planningSeen = false;

  view.syntax.arrayElements(use).forEach((entry, index) => {
    const historyKind = canonicalHistoryKind(entry, view);
    if (historyKind) {
      planningSeen = true;
      history[historyKind] += 1;
      return;
    }
    const analysis = contextPlanningWrapperAnalysis(entry, view);
    if (analysis.wrappers.length > 0) planningSeen = true;
    contributions.push({
      index,
      boundary: analysis.boundary,
      wrappers: [...analysis.wrappers],
    });
    if (!analysis.valid) {
      findings.push(invalidWrapperOrderFinding(candidate, entry, view));
    }
  });

  const historyCount = history.managed + history.recent;
  if (!planningSeen) return;
  if (historyCount > 0) facts.history = history;
  if (contributions.length > 0) facts.contributions = contributions;
  if (historyCount > 1) {
    findings.push(
      historyCardinalityFinding(candidate, use, historyCount, view),
    );
  }
}

function inputBudgetFact(
  object: Node,
  view: SemanticAnalyzerView,
): Readonly<Record<string, unknown>> | undefined {
  const budget = semanticObjectProperty(object, "inputBudget", view);
  if (!budget) return undefined;
  const values: Record<string, unknown> = { scope: "definition" };
  for (const property of view.syntax.objectProperties(budget)) {
    const name = semanticPropertyName(property, view.syntax);
    if (name !== "optimizeAt" && name !== "max") continue;
    const initializer = view.syntax.propertyInitializer(property);
    const value = initializer
      ? view.syntax.literalValue(view.syntax.unwrapExpression(initializer))
      : undefined;
    if (typeof value === "number") values[name] = value;
  }
  return values;
}

function addHook(
  candidate: SemanticDefinitionCandidate,
  property: "prepareStep" | "prepareInvocation",
  view: SemanticAnalyzerView,
  facts: Record<string, unknown>,
  refs: ProjectSourceRef[],
): void {
  if (!semanticPropertyInitializer(candidate.object, property, view.syntax)) {
    return;
  }
  facts.hooks = [
    ...((facts.hooks as readonly string[] | undefined) ?? []),
    property,
  ];
  addPropertyRef(candidate, property, "callback", view, refs);
}

function addPropertyRef(
  candidate: SemanticDefinitionCandidate,
  property: string,
  role: "config" | "callback",
  view: SemanticAnalyzerView,
  refs: ProjectSourceRef[],
): void {
  const node = semanticPropertyInitializer(
    candidate.object,
    property,
    view.syntax,
  );
  if (!node) return;
  refs.push({
    id: `${candidate.definitionId}:source:${role}:${property}`,
    role,
    property,
    source: semanticSourceForNode(node, view.syntax),
    fidelity: "resolved",
  });
}
