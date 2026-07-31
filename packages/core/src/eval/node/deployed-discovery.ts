/** Deployment discovery for inert Eval definitions. */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectEvalModules,
  evalDiscoveryScope,
  findEvalFiles,
  isEval,
  type EvalDiscoveryError,
  type EvalDiscoveryResult,
  type EvalModule,
} from "./discovery";

/** Discover inert Evals while ignoring unrelated `*.eval.*` modules. */
export async function discoverDeployableProjectEvals(
  projectRoot: string,
  options: { readonly relativeFiles?: readonly string[] } = {},
): Promise<EvalDiscoveryResult> {
  const modules: EvalModule[] = [];
  const errors: EvalDiscoveryError[] = [];
  const files = options.relativeFiles ?? (await findEvalFiles(projectRoot));
  const scopeCache = new Map<string, string>();
  for (const relativeFile of [...new Set(files)].sort()) {
    try {
      const exports = (await import(
        pathToFileURL(resolve(projectRoot, relativeFile)).href
      )) as Record<string, unknown>;
      if (Object.values(exports).some(isEval)) {
        modules.push({
          relativeFile,
          scope: await evalDiscoveryScope(projectRoot, relativeFile, scopeCache),
          exports,
        });
      }
    } catch (error) {
      errors.push({
        file: relativeFile,
        message: `Failed to import ${relativeFile}: ${errorMessage(error)}`,
      });
    }
  }
  const collected = collectEvalModules(modules);
  return Object.freeze({
    evals: collected.evals,
    errors: Object.freeze([...errors, ...collected.errors]),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
