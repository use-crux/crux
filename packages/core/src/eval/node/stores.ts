/** Private Node filesystem stores used by Eval coordination and Local. */

import { mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writeFileAtomic } from "./fs/atomic";
import { withFileLock } from "./fs/lock";
import {
  buildEvalBaseline,
  type BuildEvalBaselineOptions,
} from "../internal/baseline";
import { parseAndVerifyEvalBaselineV3 } from "../internal/baseline-schema";
import type { EvalBaselineV3 } from "../internal/baseline-types";
import {
  readTaskEvidenceEntry,
  type EvalTaskEvidenceEntry,
} from "../internal/evidence";
import type { EvalEvidenceStore, EvalRunStore } from "../internal/ports";
import { parseEvalRunV3 } from "../internal/run-schema";
import {
  readScorerEvidenceEntry,
  type EvalScorerEvidenceEntry,
} from "../internal/scorer-evidence";
import type { EvalRun } from "../internal/types";
import {
  isEvalSnapshotPersistenceSafe,
  type EvalPersistencePolicy,
} from "../internal/redact";
import { sanitizeEvalRunForPersistence } from "../internal/persistence";
import {
  EvalBaselineMigrationError,
  indexEvalBaseline,
  migrateIndexedEvalBaseline,
} from "./baseline-index";

export { EvalBaselineMigrationError } from "./baseline-index";
export { evalRunV3Schema, isEvalRunPromotable } from "../internal/run-schema";

export type EvalRunReadResult =
  | { readonly status: "found"; readonly run: EvalRun }
  | { readonly status: "missing" }
  | { readonly status: "corrupt"; readonly error: string };

export interface EvalFileStoreOptions {
  readonly projectRoot: string;
  /** Internal privacy policy; no separate public Eval configuration surface. */
  readonly persistencePolicy?: EvalPersistencePolicy;
}

export class EvalBaselineFileError extends Error {
  override readonly name = "EvalBaselineFileError";

  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(
      `Eval Baseline ${path} is invalid: ${detail}. Rerun the Eval and use baseline set to replace it.`,
    );
  }
}

/** Create the atomic sibling store for committed Eval Baseline V3 truth. */
export function createEvalBaselineFileStore(options: EvalFileStoreOptions) {
  const store = {
    async write(baseline: EvalBaselineV3): Promise<string> {
      const path = baselinePath(
        options.projectRoot,
        baseline.sourceKey.relativeFile,
      );
      const persisted = parseAndVerifyBaseline(
        parseJson(serializeJson(baseline)),
        path,
      );
      await mkdir(dirname(path), { recursive: true });
      await withFileLock(path, () =>
        writeFileAtomic(path, `${JSON.stringify(persisted, null, 2)}\n`),
      );
      await indexEvalBaseline(options.projectRoot, persisted, path);
      return path;
    },
    async read(sourceKey: {
      readonly relativeFile: string;
    }): Promise<EvalBaselineV3 | undefined> {
      const path = baselinePath(options.projectRoot, sourceKey.relativeFile);
      try {
        const baseline = parseAndVerifyBaseline(
          parseJson(await readFile(path, "utf8")),
          path,
        );
        if (baseline.sourceKey.relativeFile !== sourceKey.relativeFile) {
          throw new EvalBaselineFileError(
            path,
            "sourceKey does not match the sibling Eval source",
          );
        }
        return baseline;
      } catch (error) {
        if (isMissing(error)) return undefined;
        if (error instanceof EvalBaselineFileError) throw error;
        throw new EvalBaselineFileError(path, errorMessage(error));
      }
    },
    async readForEval(input: {
      readonly sourceKey: { readonly relativeFile: string };
      readonly evalId: string;
      readonly definitionFingerprint: string;
    }): Promise<EvalBaselineV3 | undefined> {
      const existing = await store.read(input.sourceKey);
      if (existing !== undefined) {
        if (existing.evalId !== input.evalId) {
          throw new EvalBaselineMigrationError(
            `Baseline sibling conflict: expected Eval '${input.evalId}', found '${existing.evalId}'`,
          );
        }
        return existing;
      }
      const targetPath = baselinePath(
        options.projectRoot,
        input.sourceKey.relativeFile,
      );
      return migrateIndexedEvalBaseline({
        projectRoot: options.projectRoot,
        evalId: input.evalId,
        definitionFingerprint: input.definitionFingerprint,
        sourceFile: input.sourceKey.relativeFile,
        targetPath,
        write: store.write,
      });
    },
  };
  return store;
}

/** Build and atomically set one sibling Baseline. */
export async function setEvalBaseline(input: {
  readonly projectRoot: string;
  readonly run: EvalRun;
  readonly options: BuildEvalBaselineOptions;
}): Promise<{ readonly baseline: EvalBaselineV3; readonly path: string }> {
  const baseline = buildEvalBaseline(input.run, input.options);
  const path = await createEvalBaselineFileStore({
    projectRoot: input.projectRoot,
  }).write(baseline);
  return Object.freeze({
    baseline,
    path: relative(resolve(input.projectRoot), path).split(sep).join("/"),
  });
}

/** Create an atomic filesystem store for terminal Eval V3 records. */
export function createEvalRunFileStore(
  options: EvalFileStoreOptions,
): EvalRunStore & { read(runId: string): Promise<EvalRunReadResult> } {
  const directory = join(options.projectRoot, ".crux", "evals", "runs");
  return {
    async write(run) {
      const path = artifactPath(directory, run.runId);
      const persisted = parseEvalRunV3(
        parseJson(
          serializeJson(
            sanitizeEvalRunForPersistence(run, options.persistencePolicy),
          ),
        ),
      );
      await mkdir(directory, { recursive: true });
      await withFileLock(path, () =>
        writeFileAtomic(path, `${JSON.stringify(persisted, null, 2)}\n`),
      );
    },
    async read(runId) {
      const path = artifactPath(directory, runId);
      try {
        const run = parseEvalRunV3(parseJson(await readFile(path, "utf8")));
        return run.runId === runId
          ? { status: "found", run }
          : { status: "corrupt", error: "runId does not match its file name" };
      } catch (error) {
        if (isMissing(error)) return { status: "missing" };
        return { status: "corrupt", error: errorMessage(error) };
      }
    },
  };
}

/** Create an atomic restart-safe exact-evidence store. */
export function createEvalEvidenceFileStore(
  options: EvalFileStoreOptions,
): EvalEvidenceStore {
  const directory = join(
    options.projectRoot,
    ".crux",
    "evals",
    "cache",
    "evidence",
  );
  return {
    identity: `file:${directory}`,
    consistency: "read_after_write",
    async read(key) {
      try {
        const value = parseJson(
          await readFile(artifactPath(directory, key), "utf8"),
        );
        const entry = validateEvidence(value, key);
        return evidenceIsPersistenceSafe(entry, options.persistencePolicy)
          ? entry
          : undefined;
      } catch {
        return undefined;
      }
    },
    async write(entry) {
      const path = artifactPath(directory, entry.key);
      const persisted = validateEvidence(
        parseJson(serializeJson(entry)),
        entry.key,
      );
      if (!evidenceIsPersistenceSafe(persisted, options.persistencePolicy)) {
        throw new TypeError(
          `Eval evidence ${entry.key} conflicts with the active persistence policy`,
        );
      }
      await mkdir(directory, { recursive: true });
      await withFileLock(path, () =>
        writeFileAtomic(path, `${JSON.stringify(persisted, null, 2)}\n`),
      );
    },
  };
}

function evidenceIsPersistenceSafe(
  entry: EvalTaskEvidenceEntry | EvalScorerEvidenceEntry,
  policy?: EvalPersistencePolicy,
): boolean {
  return "result" in entry
    ? isEvalSnapshotPersistenceSafe(entry.result.output, policy) &&
        isEvalSnapshotPersistenceSafe(entry.result.response, policy)
    : isEvalSnapshotPersistenceSafe(entry.score, policy);
}

function validateEvidence(
  value: unknown,
  key: string,
): EvalTaskEvidenceEntry | EvalScorerEvidenceEntry {
  const task = readTaskEvidenceEntry(value, key);
  if (task !== undefined) return task;
  const scorer = readScorerEvidenceEntry(value, key);
  if (scorer !== undefined) return scorer;
  throw new TypeError(
    `Eval evidence ${key} is not a valid complete evidence record`,
  );
}

function parseAndVerifyBaseline(value: unknown, path: string): EvalBaselineV3 {
  try {
    return parseAndVerifyEvalBaselineV3(value);
  } catch (error) {
    throw new EvalBaselineFileError(path, errorMessage(error));
  }
}

function baselinePath(projectRoot: string, sourceFile: string): string {
  const root = resolve(projectRoot);
  const source = resolve(root, sourceFile);
  const fromRoot = relative(root, source);
  if (fromRoot.startsWith("..") || isAbsolute(fromRoot)) {
    throw new TypeError("Eval source path must stay inside the project root");
  }
  const file = source.match(/^(.*)\.eval\.[cm]?[jt]sx?$/);
  if (file === null) {
    throw new TypeError("Eval source path must end in .eval.ts or .eval.js");
  }
  return `${file[1]}.baseline.json`;
}

function artifactPath(directory: string, id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new TypeError(
      "Eval artifact IDs may contain only letters, numbers, '_' and '-'",
    );
  }
  return join(directory, `${id}.json`);
}

function serializeJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new TypeError("value is not JSON serializable");
    return serialized;
  } catch (error) {
    throw new TypeError(
      `Eval artifact is not JSON serializable: ${errorMessage(error)}`,
    );
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
