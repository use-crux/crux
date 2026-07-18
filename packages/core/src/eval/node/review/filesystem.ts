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

export interface SidecarTransaction {
  /** Atomically replace the locked sidecar with one appended canonical row. */
  append(row: string): Promise<void>;
}

const sidecarQueues = new Map<string, Promise<void>>();

/** Inspect and update one sidecar while holding its repository-local lock. */
export async function withSidecarTransaction<T>(
  path: string,
  task: (transaction: SidecarTransaction) => Promise<T>,
): Promise<T> {
  return serializeSidecar(path, () => runLockedTransaction(path, task));
}

async function runLockedTransaction<T>(
  path: string,
  task: (transaction: SidecarTransaction) => Promise<T>,
): Promise<T> {
  const lockPath = `${path}.lock`;
  const lock = await acquireLock(lockPath, path);
  try {
    return await task({ append: (row) => replaceWithAppendedRow(path, row) });
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

async function serializeSidecar<T>(
  path: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = sidecarQueues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  sidecarQueues.set(path, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (sidecarQueues.get(path) === tail) sidecarQueues.delete(path);
  }
}

async function replaceWithAppendedRow(path: string, row: string): Promise<void> {
  const temporary = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
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
  }
}

async function acquireLock(lockPath: string, displayPath: string) {
  const attempts = 500;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const lock = await open(lockPath, "wx");
      await lock.writeFile(`${process.pid}\n`, "utf8");
      await lock.sync();
      return lock;
    } catch (error) {
      if (!isExists(error)) {
        throw new EvalCaseFileError(
          displayPath,
          `cannot acquire sidecar lock (${errorMessage(error)})`,
        );
      }
      const owner = await readFile(lockPath, "utf8").catch(() => "");
      const pid = Number(owner.trim());
      if (!Number.isSafeInteger(pid) || pid <= 0) break;
      if (!isProcessAlive(pid)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (attempt === attempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new EvalCaseFileError(
    displayPath,
    "another Add-to-eval write holds the sidecar lock; retry after it completes",
  );
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EPERM"
    );
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
