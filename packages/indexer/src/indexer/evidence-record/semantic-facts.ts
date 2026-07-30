import type {
  EvidenceRecordFacts,
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import { semanticDefinitionCandidates } from "../semantic/discovery";
import {
  propertyInitializer,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import { semanticSourceForNode } from "../semantic/syntax-readers";
import { projectRelation } from "../relations";
import {
  semanticDescendants,
  sourceLocationId,
  stringProperty,
} from "../embedding/semantic-values";
import {
  evidenceConclusionFact,
  evidenceKindFact,
  evidenceRoleFact,
} from "./fact-values";
import { evidenceRecordFindings } from "./findings";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

const coreModules = ["@use-crux/core", "@use-crux/core/evidence"] as const;
const sourceProperties = [
  "role",
  "kind",
  "conclusion",
  "data",
  "ref",
  "subject",
  "idempotencyKey",
  "supersedes",
] as const;

export interface SemanticEvidenceRecordFactsResult {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly lintFindings: readonly IndexLintFinding[];
}

/** Projects alias-aware canonical evidence authoring through the shared view. */
export function semanticEvidenceRecordFacts(
  root: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticEvidenceRecordFactsResult {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[] = [];
  const relations: ProjectRelation[] = [];
  const owners = sourceFiles.flatMap((sourceFile) =>
    semanticDefinitionCandidates(sourceFile, view.syntax),
  );

  for (const call of semanticDescendants(sourceFiles, view)) {
    if (!view.syntax.isKind(call, "callExpression")) continue;
    const receiver = evidenceReceiver(call, view);
    if (!receiver || !isCanonicalEvidence(receiver, view)) continue;
    const [inputExpression] = view.syntax.callArguments(call);
    const input = inputExpression
      ? semanticObjectExpression(inputExpression, view, new Set())
      : undefined;
    const id = `evidence.record:${sourceLocationId(root, call, view)}`;
    const role = evidenceRoleFact(
      input ? stringProperty(input, "role", view) : undefined,
    );
    const conclusion = evidenceConclusionFact(
      role,
      input ? stringProperty(input, "conclusion", view) : undefined,
    );
    const definitionFacts: EvidenceRecordFacts = {
      kind: "evidence.record",
      role,
      evidenceKind: evidenceKindFact(
        input ? stringProperty(input, "kind", view) : undefined,
      ),
      sourceForm: semanticSourceForm(input, view),
      subjectMode:
        input && propertyInitializer(input, "subject", view)
          ? "explicit"
          : "ambient",
      idempotent: Boolean(
        input && propertyInitializer(input, "idempotencyKey", view),
      ),
      supersedes: Boolean(
        input && propertyInitializer(input, "supersedes", view),
      ),
      ...(conclusion ? { conclusion } : {}),
    };
    const definition: ProjectDefinition = {
      id,
      kind: "evidence.record",
      name: "record",
      source: semanticSourceForNode(call, view.syntax),
      fidelity: input ? "resolved" : "partial",
      status: "active",
      metadata: { facts: definitionFacts },
    };
    definitions.push(definition);
    const owner = nearestOwner(call, owners, view);
    if (owner) {
      relations.push(
        projectRelation({
          type: "evidence.record.declared_in",
          from: id,
          to: owner.definitionId,
          fidelity: "resolved",
          source: semanticSourceForNode(call, view.syntax),
        }),
      );
    }
    if (input) {
      for (const property of sourceProperties) {
        const expression = propertyInitializer(input, property, view);
        if (!expression) continue;
        const source = semanticSourceForNode(expression, view.syntax);
        sourceRefs.push({
          definitionId: id,
          ref: {
            id: `${id}:source:config:${property}:${source.line}:${source.column}`,
            role: "config",
            property,
            source,
            fidelity: "resolved",
            description: `Authored evidence ${property} expression.`,
          },
        });
      }
    }
  }

  return {
    definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
    sourceRefs: sourceRefs.sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    lintFindings: definitions
      .flatMap(evidenceRecordFindings)
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function nearestOwner(
  call: Node,
  candidates: readonly {
    readonly definitionId: string;
    readonly call?: Node;
  }[],
  view: SemanticAnalyzerView,
) {
  const callFile = view.syntax.sourceFile(call).fileName;
  return candidates
    .filter((candidate) => {
      const owner = candidate.call;
      return (
        owner &&
        owner !== call &&
        view.syntax.sourceFile(owner).fileName === callFile &&
        owner.pos <= call.pos &&
        owner.end >= call.end
      );
    })
    .sort(
      (left, right) =>
        left.call!.end -
        left.call!.pos -
        (right.call!.end - right.call!.pos),
    )[0];
}

function evidenceReceiver(
  call: Node,
  view: SemanticAnalyzerView,
): Node | undefined {
  const target = view.syntax.callExpressionTarget(call);
  if (
    !target ||
    !view.syntax.isKind(target, "propertyAccessExpression") ||
    view.syntax.propertyAccessName(target) !== "record"
  ) {
    return undefined;
  }
  return view.syntax.propertyAccessExpression(target);
}

function isCanonicalEvidence(
  receiver: Node,
  view: SemanticAnalyzerView,
): boolean {
  return coreModules.some((moduleName) =>
    Boolean(view.canonicalExportIdentity(receiver, moduleName, "evidence")),
  );
}

function semanticSourceForm(
  input: Node | undefined,
  view: SemanticAnalyzerView,
): EvidenceRecordFacts["sourceForm"] {
  if (!input) return "unresolved";
  const inline = Boolean(propertyInitializer(input, "data", view));
  const reference = Boolean(propertyInitializer(input, "ref", view));
  if (inline === reference) return "invalid";
  return inline ? "inline" : "reference";
}
