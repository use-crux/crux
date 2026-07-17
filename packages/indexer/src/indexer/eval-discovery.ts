import type {
  IndexDiagnostic,
  IndexSourceFile,
  ProjectDefinition,
  ProjectRelation,
} from "@use-crux/core/project-index";
import { moduleImportFailedDiagnostic } from "./diagnostics";
import {
  definitionFromAuthoredEval,
  type DiscoveredAuthoredEval,
  isAuthoredEval,
} from "./evaluations";
import { codeFilesFromGlobs } from "./files";
import { importUserModule, withCruxIndexMode } from "./imports";
import { sourceStatus } from "./sources";

export interface RuntimeDiscoveryResult {
  definitions: ProjectDefinition[];
  relations: ProjectRelation[];
  failedImportFiles: string[];
  diagnostics: IndexDiagnostic[];
  sources: readonly IndexSourceFile[];
}

/**
 * Import Eval modules and index their single default inert Eval export.
 */
export async function discoverRuntimeEvalDefinitions(
  root: string,
  patterns: string[],
  sources: readonly IndexSourceFile[],
): Promise<RuntimeDiscoveryResult> {
  const definitions: ProjectDefinition[] = [];
  const relations: ProjectRelation[] = [];
  const failedImportFiles: string[] = [];

  const evalModules = await discoverModules(root, patterns, sources);
  for (const moduleResult of evalModules) {
    if (!moduleResult.ok) {
      failedImportFiles.push(moduleResult.file);
      continue;
    }
    const authoredEvals = Object.entries(moduleResult.exports).filter(
      (entry): entry is [string, DiscoveredAuthoredEval] =>
        isAuthoredEval(entry[1]),
    );
    if (authoredEvals.length === 1 && authoredEvals[0]![0] === "default") {
      definitions.push(
        await definitionFromAuthoredEval(
          root,
          moduleResult.file,
          "default",
          authoredEvals[0]![1],
        ),
      );
    }
  }

  return {
    definitions,
    relations,
    failedImportFiles,
    diagnostics: evalModules.flatMap(
      (moduleResult) => moduleResult.diagnostics,
    ),
    sources: evalModules.at(-1)?.sources ?? sources,
  };
}

async function discoverModules(
  root: string,
  patterns: string[],
  sources: readonly IndexSourceFile[],
): Promise<
  Array<
    | {
        ok: true;
        file: string;
        exports: Record<string, unknown>;
        diagnostics: readonly IndexDiagnostic[];
        sources: readonly IndexSourceFile[];
      }
    | {
        ok: false;
        file: string;
        diagnostics: readonly IndexDiagnostic[];
        sources: readonly IndexSourceFile[];
      }
  >
> {
  const files = codeFilesFromGlobs(root, patterns);
  const results: Array<
    | {
        ok: true;
        file: string;
        exports: Record<string, unknown>;
        diagnostics: readonly IndexDiagnostic[];
        sources: readonly IndexSourceFile[];
      }
    | {
        ok: false;
        file: string;
        diagnostics: readonly IndexDiagnostic[];
        sources: readonly IndexSourceFile[];
      }
  > = [];
  let nextSources = sources;
  for (const file of files) {
    nextSources = sourceStatus(nextSources, file, "indexed");
    await withCruxIndexMode(async () => {
      try {
        const mod = await importUserModule(file, 4_000);
        results.push({
          ok: true,
          file,
          exports: Object.fromEntries(Object.entries(mod)),
          diagnostics: [],
          sources: nextSources,
        });
      } catch (error) {
        nextSources = sourceStatus(nextSources, file, "error");
        results.push({
          ok: false,
          file,
          diagnostics: [
            moduleImportFailedDiagnostic(root, file, errorMessage(error)),
          ],
          sources: nextSources,
        });
      }
    });
  }
  return results;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
