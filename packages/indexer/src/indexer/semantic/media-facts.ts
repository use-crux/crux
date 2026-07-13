import type {
  IndexLintFinding,
  MediaOperationFacts,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { safeId } from "../definitions";
import { authoredMediaPrimitiveManifest } from "../media/manifest";
import { projectRelation } from "../relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "./candidates";
import {
  semanticObjectExpression,
  propertyInitializer,
} from "./model/object-readers";
import { semanticTargetForExpression } from "./model/target-resolution";
import { semanticMediaCallEvidence } from "./media-call-evidence";
import {
  semanticMediaMisuse,
  semanticMediaModalities,
  semanticMediaOperationFacts,
  semanticMediaOutputIsDiscarded,
} from "./media-fact-values";
import {
  semanticSourceForNode,
  semanticVariableNameForNode,
} from "./syntax-readers";

export interface SemanticMediaFacts {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly lintFindings: readonly IndexLintFinding[];
}

const routingRelation = authoredMediaPrimitiveManifest.relations.find(
  ([, property]) => property === "routing",
)?.[0];

/** Projects authored media calls through backend-neutral compiler evidence. */
export function semanticMediaFacts(
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticMediaFacts {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = [];
  const relations: ProjectRelation[] = [];
  const lintFindings: IndexLintFinding[] = [];
  for (const sourceFile of sourceFiles) {
    for (const call of descendants(sourceFile, view)) {
      if (!view.syntax.isKind(call, "callExpression")) continue;
      const evidence = semanticMediaCallEvidence(call, view);
      if (!evidence) continue;
      const args = view.syntax.callArguments(call);
      const argument = args[evidence.configArgument];
      const config = argument
        ? semanticObjectExpression(argument, view, new Set())
        : undefined;
      if (!config) continue;
      const modalities = semanticMediaModalities(config, view);
      if (
        (evidence.operation === "generate" ||
          evidence.operation === "stream") &&
        modalities.length === 0
      )
        continue;
      const name = semanticVariableNameForNode(call, view.syntax);
      if (!name) continue;
      const id = `media.operation:${safeId(name)}`;
      const adapter = evidence.adapter;
      const facts = semanticMediaOperationFacts(
        evidence.operation,
        config,
        modalities,
        adapter,
        view,
      );
      definitions.push({
        id,
        kind: "media.operation",
        name,
        source: semanticSourceForNode(call, view.syntax),
        fidelity: "resolved",
        status: "active",
        metadata: { facts, indexPresentation: { standalone: true } },
      });
      if (
        argument &&
        !view.syntax.isKind(
          view.syntax.unwrapExpression(argument),
          "objectLiteral",
        )
      ) {
        const source = semanticSourceForNode(argument, view.syntax);
        sourceRefs.push({
          definitionId: id,
          ref: {
            id: `${id}:config:${source.line}:${source.column}`,
            role: "config",
            property: "options",
            source,
            fidelity: "resolved",
          },
        });
      }
      const model = propertyInitializer(config, "model", view);
      const target = model
        ? semanticTargetForExpression(model, view)
        : undefined;
      if (routingRelation && target?.kind.startsWith("routing.")) {
        relations.push(
          projectRelation({
            type: routingRelation,
            from: id,
            to: target.id,
            fidelity: "resolved",
            source: semanticSourceForNode(model!, view.syntax),
          }),
        );
      }
      const prompt = args[0];
      const promptTarget =
        evidence.operation === "generate" || evidence.operation === "stream"
          ? prompt
            ? semanticTargetForExpression(prompt, view)
            : undefined
          : undefined;
      if (prompt && promptTarget?.kind === "prompt") {
        relations.push(
          projectRelation({
            type: "media.uses_prompt",
            from: id,
            to: promptTarget.id,
            fidelity: "resolved",
            source: semanticSourceForNode(prompt, view.syntax),
          }),
        );
      }
      const misuse = semanticMediaMisuse(
        config,
        adapter,
        evidence.operation,
        view,
      );
      if (misuse.unsupportedCapability)
        lintFindings.push(
          mediaFinding(
            "media.unsupported-capability",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.providerFile)
        lintFindings.push(
          mediaFinding(
            "media.invalid-provider-file",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.assetRef)
        lintFindings.push(
          mediaFinding(
            "media.asset-ref-not-hydrated",
            "error",
            id,
            facts,
            call,
            view,
          ),
        );
      if (misuse.rawRetention)
        lintFindings.push(
          mediaFinding("media.raw-retention", "warning", id, facts, call, view),
        );
      if (semanticMediaOutputIsDiscarded(call, name, sourceFiles, view)) {
        lintFindings.push(
          mediaFinding(
            "media.output-discarded",
            "warning",
            id,
            facts,
            call,
            view,
          ),
        );
      }
    }
  }
  return {
    definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
    sourceRefs: sourceRefs.sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    relations: relations.sort((a, b) => a.id.localeCompare(b.id)),
    lintFindings: lintFindings.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function mediaFinding(
  ruleId: string,
  severity: "error" | "warning",
  definitionId: string,
  facts: MediaOperationFacts,
  node: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): IndexLintFinding {
  const source = semanticSourceForNode(node, view.syntax);
  return {
    id: `${ruleId}:${definitionId}:${source.line}:${source.column}`,
    ruleId,
    severity,
    category: "quality",
    maturity: "experimental",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: ruleId,
    message: `Authored media evidence triggered ${ruleId}.`,
    rationale:
      "The compiler proved this condition from resolved authored source.",
    impact: "The media operation may fail or its result may be lost.",
    source,
    primaryDefinitionId: definitionId,
    relatedDefinitionIds: [],
    evidence: [
      {
        kind: "source",
        label: "Resolved media evidence",
        source,
        data: {
          source: "semantic",
          fidelity: "resolved",
          capability: facts.operation,
          ...(facts.adapter ? { adapter: facts.adapter } : {}),
          ...(facts.model ? { model: facts.model } : {}),
        },
      },
    ],
    fixes: [
      {
        title: "Correct the media operation",
        description:
          "Hydrate or route the media value and consume the canonical result fields.",
        kind: "manual",
      },
    ],
    docsUrl: "https://cruxjs.dev/docs/guides/multimodal",
  };
}

function descendants(
  root: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
) {
  const out: SemanticAnalyzerNode<SemanticAnalyzerView>[] = [];
  const visit = (node: SemanticAnalyzerNode<SemanticAnalyzerView>) => {
    out.push(node);
    view.childNodes(node).forEach(visit);
  };
  visit(root);
  return out;
}
