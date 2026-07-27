/** Canonical source and hydrated-Case identity for Node Eval discovery. */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { EvalDefinitionV1 } from "../internal/definition";
import { fingerprintEvalValue } from "../internal/identity";
import type { DiscoveredEval } from "./discovery";
import type { LoadedEvalCase } from "./cases";
import { EvalCaseFileError } from "./case-path";
import {
  fingerprintEvalSourceClosure,
  type EvalSourceClosureIdentity,
} from "./source-dependencies";
import {
  projectResolvedEvalTimeoutPolicy,
  resolveEvalTimeoutPolicy,
} from "../timeout-policy";

export interface EvalDefinitionIdentity {
  readonly fingerprint: string;
  readonly sourceClosure: EvalSourceClosureIdentity;
}

/** Fingerprint source semantics after canonicalizing authored Case paths. */
export async function fingerprintEvalDefinition(input: {
  readonly discovered: DiscoveredEval;
  readonly definition: EvalDefinitionV1;
  readonly cases: readonly LoadedEvalCase[];
  readonly caseFileDependencies: readonly string[];
  readonly projectRoot: string;
}): Promise<EvalDefinitionIdentity> {
  const authoredSource = await readFile(
    insideProjectRoot(
      input.projectRoot,
      input.discovered.sourceKey.relativeFile,
    ),
    "utf8",
  );
  const source = input.definition.caseFiles.reduce(
    (normalized, reference, index) =>
      normalized.replaceAll(
        reference.path,
        input.caseFileDependencies[index] ?? reference.path,
      ),
    authoredSource,
  );
  const sourceClosure = await fingerprintEvalSourceClosure({
    projectRoot: input.projectRoot,
    entryFile: input.discovered.sourceKey.relativeFile,
    entryIdentitySource: source,
  });
  const material = {
    identityEpoch: 2,
    source,
    sourceClosureFingerprint: sourceClosure.fingerprint,
    evalId: input.discovered.id,
    timeout: projectResolvedEvalTimeoutPolicy(
      resolveEvalTimeoutPolicy(undefined, input.definition.timeout),
    ),
    caseFileDependencies: input.caseFileDependencies,
    cases: input.cases.map((entry) => ({
      id: entry.id,
      value: fingerprintEvalValue({
        input: entry.authored.input,
        ...(entry.authored.name !== undefined
          ? { name: entry.authored.name }
          : {}),
        ...(entry.authored.call !== undefined
          ? { call: entry.authored.call }
          : {}),
        ...(entry.authored.expected !== undefined
          ? { expected: entry.authored.expected }
          : {}),
        ...(entry.authored.unvalidatedExpected === true
          ? { unvalidatedExpected: true }
          : {}),
        ...(entry.authored.trials !== undefined
          ? { trials: entry.authored.trials }
          : {}),
        ...(entry.authored.tags !== undefined
          ? { tags: entry.authored.tags }
          : {}),
        ...(entry.authored.skip !== undefined
          ? { skip: entry.authored.skip }
          : {}),
        ...(entry.authored.only !== undefined
          ? { only: entry.authored.only }
          : {}),
        timeout: projectResolvedEvalTimeoutPolicy(
          resolveEvalTimeoutPolicy(
            input.definition.timeout,
            entry.authored.timeout,
          ),
        ),
      }),
    })),
    arms: input.definition.arms,
  };
  return Object.freeze({
    fingerprint: createHash("sha256")
      .update(JSON.stringify(material))
      .digest("hex"),
    sourceClosure,
  });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export function insideProjectRoot(projectRoot: string, path: string): string {
  const root = resolve(projectRoot);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const fromRoot = relative(root, absolute);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith("../") ||
    fromRoot.startsWith("..\\") ||
    isAbsolute(fromRoot)
  ) {
    throw new EvalCaseFileError(path, "path must stay inside the project root");
  }
  return absolute;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
