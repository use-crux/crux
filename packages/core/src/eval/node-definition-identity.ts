/** Canonical source and hydrated-Case identity for Node Eval discovery. */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { EvalDefinitionV1 } from "./internal/definition";
import { fingerprintEvalValue } from "./internal/identity";
import type { DiscoveredEval } from "./node-discovery";
import type { LoadedEvalCase } from "./node-cases";
import { EvalCaseFileError } from "./node-case-path";

/** Fingerprint source semantics after canonicalizing authored Case paths. */
export async function fingerprintEvalDefinition(input: {
  readonly discovered: DiscoveredEval;
  readonly definition: EvalDefinitionV1;
  readonly cases: readonly LoadedEvalCase[];
  readonly caseFileDependencies: readonly string[];
  readonly projectRoot: string;
}): Promise<string> {
  const authoredSource = await readFile(
    insideProjectRoot(input.projectRoot, input.discovered.sourceKey.relativeFile),
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
  const material = {
    source,
    evalId: input.discovered.id,
    caseFileDependencies: input.caseFileDependencies,
    cases: input.cases.map((entry) => ({
      id: entry.id,
      value: fingerprintEvalValue({
        input: entry.authored.input,
        ...(entry.authored.name !== undefined ? { name: entry.authored.name } : {}),
        ...(entry.authored.call !== undefined ? { call: entry.authored.call } : {}),
        ...(entry.authored.expected !== undefined ? { expected: entry.authored.expected } : {}),
        ...(entry.authored.unvalidatedExpected === true
          ? { unvalidatedExpected: true }
          : {}),
        ...(entry.authored.trials !== undefined ? { trials: entry.authored.trials } : {}),
        ...(entry.authored.tags !== undefined ? { tags: entry.authored.tags } : {}),
        ...(entry.authored.skip !== undefined ? { skip: entry.authored.skip } : {}),
        ...(entry.authored.only !== undefined ? { only: entry.authored.only } : {}),
      }),
    })),
    arms: input.definition.arms,
  };
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
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
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
