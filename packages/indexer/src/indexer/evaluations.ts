import { readFile } from "node:fs/promises";
import type {
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import type { EvaluationManifest } from "@use-crux/core/quality";
import { foldedIndexChild } from "./index-presentation";
import { definition, relation, safeId } from "./definitions";
import { assertionSitesFromSource } from "./evaluation-assertion-sites";

/**
 * A Quality `Evaluation` value as seen by runtime discovery: the frozen
 * handle returned by `evaluate()`, carrying its serializable manifest.
 */
export interface DiscoveredEvaluation {
  readonly _tag: "CruxEvaluation";
  readonly manifest: EvaluationManifest;
}

/** New inert Eval handle; private details stay owned by project-local Core. */
export interface DiscoveredAuthoredEval {
  readonly _tag: "CruxEval";
  readonly id?: string;
}

export function isEvaluation(value: unknown): value is DiscoveredEvaluation {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as { _tag?: unknown; manifest?: unknown };
  return (
    candidate._tag === "CruxEvaluation" &&
    candidate.manifest != null &&
    typeof candidate.manifest === "object" &&
    (candidate.manifest as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

/** Identify the inert Eval brand without reading callbacks, schemas, or tasks. */
export function isAuthoredEval(
  value: unknown,
): value is DiscoveredAuthoredEval {
  return (
    value !== null &&
    typeof value === "object" &&
    "_tag" in value &&
    value._tag === "CruxEval"
  );
}

/** Build the safe Project Index corroboration record for a deployed Eval. */
export async function definitionFromAuthoredEval(
  root: string,
  file: string,
  exportName: string,
  evalValue: DiscoveredAuthoredEval,
): Promise<ProjectDefinition> {
  const name = evalValue.id ?? derivedEvalId(root, file);
  return definition(
    root,
    file,
    `evaluation:${safeId(name)}`,
    "evaluation",
    name,
    undefined,
    {
      exportName,
      evalContract: "crux.eval",
      explicitId: evalValue.id !== undefined,
      requiredHostCapabilities: [],
      facts: {
        kind: "evaluation",
        evalContract: "crux.eval",
        requiredHostCapabilities: [],
      },
    },
  );
}

/**
 * Build Project Index definitions for one discovered evaluation: the
 * `evaluation` definition itself plus folded `evaluation.case` children,
 * linked by `evaluation.includes_case` relations. Everything is read off the
 * serializable manifest — no task executes.
 */
export async function definitionsFromEvaluation(
  root: string,
  file: string,
  exportName: string,
  manifest: EvaluationManifest,
): Promise<{ definitions: ProjectDefinition[]; relations: ProjectRelation[] }> {
  const name = manifest.id || exportName;
  const assertionSites = await readAssertionSites(file, exportName);
  const coverageTargets = manifest.covers ?? [];
  const evaluationDefinition = await definition(
    root,
    file,
    `evaluation:${safeId(name)}`,
    "evaluation",
    name,
    manifest.description,
    {
      source: manifest.source,
      taskKind: manifest.task.kind,
      ...(manifest.task.ref !== undefined
        ? { taskRef: manifest.task.ref }
        : {}),
      caseCount: manifest.cases.length,
      datasetCount: manifest.datasets.length,
      ...(coverageTargets.length > 0 ? { covers: [...coverageTargets] } : {}),
      scorers: manifest.scorers.map((scorer) => scorer.name),
      variants: manifest.variants.map((variant) => variant.name),
      trials: manifest.trials,
      explicitId: manifest.explicitId,
      ...(assertionSites.length > 0 ? { assertionSites } : {}),
      facts: {
        kind: "evaluation",
        taskKind: manifest.task.kind,
        caseCount: manifest.cases.length,
        ...(coverageTargets.length > 0 ? { covers: [...coverageTargets] } : {}),
        ...(assertionSites.length > 0 ? { assertionSites } : {}),
      },
    },
  );

  const caseDefinitions = await Promise.all(
    manifest.cases.map((manifestCase) =>
      definition(
        root,
        file,
        `evaluation.case:${safeId(name)}:${safeId(manifestCase.caseId)}`,
        "evaluation.case",
        manifestCase.name ?? manifestCase.caseId,
        undefined,
        {
          evaluationId: name,
          caseId: manifestCase.caseId,
          trials: manifestCase.trials,
          facts: {
            kind: "evaluation.case",
            evaluationId: name,
          },
          indexPresentation: foldedIndexChild({
            parentDefinitionId: evaluationDefinition.id,
            parentRelationType: "evaluation.includes_case",
            role: "case",
          }),
          ...(manifestCase.tags.length > 0
            ? { tags: [...manifestCase.tags] }
            : {}),
        },
      ),
    ),
  );

  return {
    definitions: [evaluationDefinition, ...caseDefinitions],
    relations: [
      ...caseDefinitions.map((caseDefinition) =>
        relation(
          "evaluation.includes_case",
          evaluationDefinition.id,
          caseDefinition.id,
          file,
        ),
      ),
      ...coverageTargets.map((targetId) =>
        relation(
          "eval.covers_definition",
          evaluationDefinition.id,
          targetId,
          file,
        ),
      ),
    ],
  };
}

async function readAssertionSites(file: string, exportName: string) {
  try {
    return assertionSitesFromSource({
      file,
      exportName,
      source: await readFile(file, "utf8"),
    });
  } catch {
    return [];
  }
}

/**
 * The prompt a task wraps, when the manifest names one — used to emit
 * `evaluation.targets_prompt` relations against the indexed prompt set.
 */
export function evaluationPromptId(
  manifest: EvaluationManifest,
): string | undefined {
  return manifest.task.kind === "prompt" ? manifest.task.ref : undefined;
}

function derivedEvalId(root: string, file: string): string {
  const relativeFile = file
    .slice(root.length)
    .replace(/^[/\\]/, "")
    .replace(/\\/g, "/");
  const beneathEvals = relativeFile.startsWith("evals/")
    ? relativeFile.slice("evals/".length)
    : relativeFile;
  return beneathEvals.replace(/\.eval\.[cm]?[jt]sx?$/, "").replaceAll("/", ".");
}
