import type { ProjectDefinition } from "@use-crux/core/project-index";
import { definition, safeId } from "./definitions";

/** Inert Eval handle shape visible to runtime-rich Project Index discovery. */
export interface DiscoveredAuthoredEval {
  readonly _tag: "CruxEval";
  readonly id?: string;
}

/** Identify an inert Eval without reading callbacks, schemas, or tasks. */
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

/** Build safe Project Index corroboration for a deployed Eval. */
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
