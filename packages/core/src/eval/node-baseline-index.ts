/** Node-only source-key index for bounded Eval Baseline rename migration. @internal */

import { mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "../quality/internal/fs-atomic";
import { withFileLock } from "../quality/internal/fs-lock";
import { fingerprintEvalValue } from "./internal/identity";
import { parseAndVerifyEvalBaselineV3 } from "./internal/baseline-schema";
import type { EvalBaselineV3 } from "./internal/baseline-types";

interface BaselineIndexEntry {
  readonly baselineId: string;
  readonly evalId: string;
  readonly sourceFile: string;
  readonly definitionFingerprint: string;
  readonly path: string;
}

export class EvalBaselineMigrationError extends Error {
  override readonly name = "EvalBaselineMigrationError";
}

export async function indexEvalBaseline(
  projectRoot: string,
  baseline: EvalBaselineV3,
  path: string,
): Promise<void> {
  const indexPath = pathForIndex(projectRoot);
  await mkdir(dirname(indexPath), { recursive: true });
  await withFileLock(indexPath, async () => {
    const entries = await readIndex(indexPath);
    const next = entries.filter((entry) => entry.baselineId !== baseline.baselineId);
    next.push({
      baselineId: baseline.baselineId,
      evalId: baseline.evalId,
      sourceFile: baseline.sourceKey.relativeFile,
      definitionFingerprint: baseline.provenance.definitionFingerprint,
      path: relative(resolve(projectRoot), path),
    });
    await writeFileAtomic(
      indexPath,
      `${JSON.stringify({ schemaVersion: 1, entries: next }, null, 2)}\n`,
    );
  });
}

export async function migrateIndexedEvalBaseline(input: {
  readonly projectRoot: string;
  readonly evalId: string;
  readonly definitionFingerprint: string;
  readonly sourceFile: string;
  readonly targetPath: string;
  readonly write: (baseline: EvalBaselineV3) => Promise<string>;
}): Promise<EvalBaselineV3 | undefined> {
  const entries = await readIndex(pathForIndex(input.projectRoot));
  const candidates = entries.filter(
    (entry) =>
      entry.sourceFile !== input.sourceFile &&
      (entry.evalId === input.evalId ||
        entry.definitionFingerprint === input.definitionFingerprint),
  );
  if (candidates.length === 0) return undefined;
  if (candidates.length !== 1) {
    throw new EvalBaselineMigrationError(
      `Eval Baseline rename is ambiguous across ${candidates.length} candidates; move the intended sibling file explicitly`,
    );
  }
  const candidate = candidates[0]!;
  const oldPath = resolve(input.projectRoot, candidate.path);
  const baseline = parseAndVerifyEvalBaselineV3(
    JSON.parse(await readFile(oldPath, "utf8")) as unknown,
  );
  const { snapshotFingerprint: _oldFingerprint, ...oldMaterial } = baseline;
  const material = {
    ...oldMaterial,
    evalId: input.evalId,
    sourceKey: { relativeFile: input.sourceFile, export: "default" as const },
  };
  const migrated = {
    ...material,
    snapshotFingerprint: fingerprintEvalValue(material),
  } as EvalBaselineV3;
  await input.write(migrated);
  if (oldPath !== input.targetPath) await unlink(oldPath);
  return migrated;
}

async function readIndex(path: string): Promise<readonly BaselineIndexEntry[]> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    throw new EvalBaselineMigrationError(`Eval Baseline index ${path} is corrupt`);
  }
  return value.entries.filter(isIndexEntry);
}

function isIndexEntry(value: unknown): value is BaselineIndexEntry {
  return (
    isRecord(value) &&
    [value.baselineId, value.evalId, value.sourceFile, value.definitionFingerprint, value.path].every(
      (entry) => typeof entry === "string",
    )
  );
}

function pathForIndex(projectRoot: string): string {
  return join(projectRoot, ".crux", "quality", "baseline-index.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
