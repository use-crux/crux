/** Schema-validated JSON, JSONL, and CSV Case hydration for Node Evals. */

import type { RawEvalCase } from "../internal/definition";
import {
  fingerprintEvalValueForInternalUse,
  getEvalDefinitionForInternalUse,
  getEvalTaskSchemasForInternalUse,
  materializeEvalForInternalUse,
} from "../internal/runner";
import type { DiscoveredEval } from "./discovery";
import {
  EvalCaseFileError,
  resolveAuthoredCaseFile,
  resolveAutomaticCaseFile,
} from "./case-path";
import { fingerprintEvalDefinition } from "./definition-identity";
import type { EvalSourceClosureIdentity } from "./source-dependencies";
import { loadCaseRows } from "./case-rows";

export { loadCaseRows } from "./case-rows";

export interface LoadedEvalCase {
  readonly id: string;
  readonly origin: string;
  readonly authored: RawEvalCase;
  readonly unvalidatedExpected: boolean;
}

export interface HydratedEval extends DiscoveredEval {
  readonly cases: readonly LoadedEvalCase[];
  readonly definitionFingerprint: string;
  readonly sourceClosure: EvalSourceClosureIdentity;
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
  const sidecar = await resolveAutomaticCaseFile(
    options.projectRoot,
    discovered.sidecarFile,
  );
  const hasSidecar = sidecar.exists;
  const schemas = getEvalTaskSchemasForInternalUse(discovered.eval);
  if (
    (hasSidecar || definition.caseFiles.length > 0) &&
    schemas.inputSchema === undefined
  ) {
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
      const origin = `${discovered.sourceKey.relativeFile}:inline:${position.index + 1}`;
      const input =
        schemas.inputSchema === undefined
          ? authored.input
          : await validateInlineValue(
              schemas.inputSchema,
              authored.input,
              origin,
              "input",
            );
      const expected =
        authored.expected === undefined || schemas.outputSchema === undefined
          ? authored.expected
          : await validateInlineValue(
              schemas.outputSchema,
              authored.expected,
              origin,
              "expected",
            );
      const normalized = Object.freeze({
        ...authored,
        input,
        ...(authored.expected !== undefined ? { expected } : {}),
      });
      merged.push(
        Object.freeze({
          id: authored.id ?? fingerprintEvalValueForInternalUse(input),
          origin,
          authored: normalized,
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
        path: sidecar.absolutePath,
        displayPath: discovered.sidecarFile,
        kind: "sidecar",
        inputSchema: schemas.inputSchema!,
      })),
    );
  }
  assertUniqueCaseIds(merged);
  const definitionIdentity = await fingerprintEvalDefinition({
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
    definitionFingerprint: definitionIdentity.fingerprint,
    sourceClosure: definitionIdentity.sourceClosure,
  });
}

async function validateInlineValue(
  schema: NonNullable<
    ReturnType<typeof getEvalTaskSchemasForInternalUse>["inputSchema"]
  >,
  value: unknown,
  origin: string,
  field: "input" | "expected",
): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if (result.issues !== undefined) {
    throw new EvalCaseFileError(
      origin,
      `${field} failed schema validation: ${result.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  return result.value;
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
