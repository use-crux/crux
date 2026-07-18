/** Deployment discovery for inert Eval definitions. */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectEvalModules,
  findEvalFiles,
  isEval,
  type EvalDiscoveryError,
  type EvalDiscoveryResult,
  type EvalModule,
} from "./discovery";

/** Discover inert Evals while ignoring unrelated `*.eval.*` modules. */
export async function discoverDeployableProjectEvals(
  projectRoot: string,
): Promise<EvalDiscoveryResult> {
  const modules: EvalModule[] = [];
  const errors: EvalDiscoveryError[] = [];
  for (const relativeFile of await findEvalFiles(projectRoot)) {
    try {
      const exports = (await import(
        pathToFileURL(resolve(projectRoot, relativeFile)).href
      )) as Record<string, unknown>;
      if (Object.values(exports).some(isEval)) {
        modules.push({ relativeFile, exports });
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
