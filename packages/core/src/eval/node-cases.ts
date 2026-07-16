/** Schema-validated JSON, JSONL, and CSV Case hydration for Node Evals. */

import type { RawEvalCase } from "./internal/definition";
import {
  fingerprintEvalValueForInternalUse,
  getEvalDefinitionForInternalUse,
  getEvalTaskSchemasForInternalUse,
  materializeEvalForInternalUse,
} from "./internal/runner";
import type { DiscoveredEval } from "./node-discovery";
import { EvalCaseFileError, resolveAuthoredCaseFile } from "./node-case-path";
import {
  fingerprintEvalDefinition,
  insideProjectRoot,
  pathExists,
} from "./node-definition-identity";
import { loadCaseRows } from "./node-case-rows";

export { loadCaseRows } from "./node-case-rows";

export interface LoadedEvalCase {
  readonly id: string;
  readonly origin: string;
  readonly authored: RawEvalCase;
  readonly unvalidatedExpected: boolean;
}

export interface HydratedEval extends DiscoveredEval {
  readonly cases: readonly LoadedEvalCase[];
  readonly definitionFingerprint: string;
  readonly caseFileDependencies: readonly string[];
  readonly filteredSelection?: true;
}

export interface EvalCaseHydrationOptions {
  readonly projectRoot: string;
  readonly registerWatchDependency?: (canonicalPath: string) => void;
}

/** Merge authored sources in declaration order, followed by the sibling. */
export async function hydrateEvalCases(
  discovered: DiscoveredEval,
  options: EvalCaseHydrationOptions,
): Promise<HydratedEval> {
  const definition = getEvalDefinitionForInternalUse(discovered.eval);
  const sidecarPath = insideProjectRoot(options.projectRoot, discovered.sidecarFile);
  const hasSidecar = await pathExists(sidecarPath);
  const schemas = getEvalTaskSchemasForInternalUse(discovered.eval);
  if ((hasSidecar || definition.caseFiles.length > 0) && schemas.inputSchema === undefined) {
    throw new EvalCaseFileError(
      discovered.sourceKey.relativeFile,
      "file-backed Cases require a managed task with an input Standard Schema",
    );
  }
  const merged: LoadedEvalCase[] = [];
  const caseFileDependencies: string[] = [];
  for (const position of definition.caseSourceOrder) {
    if (position.kind === "inline") {
      const authored = definition.cases[position.index]!;
      merged.push(
        Object.freeze({
          id: authored.id ?? fingerprintEvalValueForInternalUse(authored.input),
          origin: `${discovered.sourceKey.relativeFile}:inline:${position.index + 1}`,
          authored,
          unvalidatedExpected: false,
        }),
      );
      continue;
    }
    const reference = definition.caseFiles[position.index]!;
    const resolved = await resolveAuthoredCaseFile({
      projectRoot: options.projectRoot,
      sourceFile: discovered.sourceKey.relativeFile,
      sidecarFile: discovered.sidecarFile,
      authoredPath: reference.path,
      registerWatchDependency: (canonicalPath) => {
        caseFileDependencies.push(canonicalPath);
        options.registerWatchDependency?.(canonicalPath);
      },
    });
    merged.push(
      ...(await loadCaseRows({
        path: resolved.absolutePath,
        displayPath: resolved.canonicalPath,
        kind: "authored",
        inputSchema: reference.inputSchema,
        ...(reference.expectedSchema !== undefined
          ? { expectedSchema: reference.expectedSchema }
          : {}),
      })),
    );
  }
  if (hasSidecar) {
    merged.push(
      ...(await loadCaseRows({
        path: sidecarPath,
        displayPath: discovered.sidecarFile,
        kind: "sidecar",
        inputSchema: schemas.inputSchema!,
      })),
    );
  }
  assertUniqueCaseIds(merged);
  const definitionFingerprint = await fingerprintEvalDefinition({
    discovered,
    definition,
    cases: merged,
    caseFileDependencies,
    projectRoot: options.projectRoot,
  });
  return Object.freeze({
    ...discovered,
    eval: materializeEvalForInternalUse(discovered.eval, {
      id: discovered.id,
      cases: merged.map((entry) => entry.authored),
    }),
    cases: Object.freeze(merged),
    caseFileDependencies: Object.freeze(caseFileDependencies),
    definitionFingerprint,
  });
}

function assertUniqueCaseIds(cases: readonly LoadedEvalCase[]): void {
  const seen = new Map<string, string>();
  for (const entry of cases) {
    const previous = seen.get(entry.id);
    if (previous !== undefined) {
      throw new EvalCaseFileError(
        entry.origin,
        `duplicate Case id '${entry.id}' from ${previous} and ${entry.origin}`,
      );
    }
    seen.set(entry.id, entry.origin);
  }
}
