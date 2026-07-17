import { open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { EvalCaseFileError } from "../case-path";
import { resolveAutomaticCaseFile } from "../case-path";

/** Resolve a generated sidecar without permitting lexical or symlink escape. */
export async function resolveReviewSidecar(
  projectRoot: string,
  relativePath: string,
): Promise<string> {
  return (await resolveAutomaticCaseFile(projectRoot, relativePath))
    .absolutePath;
}

/** Atomically replace a sidecar while holding its repository-local lock. */
export async function atomicAppend(path: string, row: string): Promise<void> {
  const lockPath = `${path}.lock`;
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    throw new EvalCaseFileError(
      path,
      isExists(error)
        ? "another Add-to-eval write holds the sidecar lock; retry after it completes"
        : `cannot acquire sidecar lock (${errorMessage(error)})`,
    );
  }
  try {
    const current = await readFile(path, "utf8").catch((error: unknown) => {
      if (isMissing(error)) return "";
      throw error;
    });
    const prefix =
      current === "" || current.endsWith("\n") ? current : `${current}\n`;
    const file = await open(temporary, "wx");
    try {
      await file.writeFile(`${prefix}${row}`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await rm(temporary, { force: true });
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
