import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { createPostgresTestPool } from "./test-database";

export interface RuntimeWorkerProjectFixture {
  readonly root: string;
  readonly schema: string;
  readonly url: string;
  readonly executionMarker: string;
}

export interface WorkerProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>;
  readonly ownershipMarker: string;
  readonly stderr: () => string;
}

let workerNumber = 0;

export function startWorker(
  workerScript: string,
  root: string,
  env: Readonly<Record<string, string>> = {},
): WorkerProcess {
  const ownershipMarker = join(
    root,
    `.runtime-worker-ownership-${workerNumber++}`,
  );
  const child = spawn(process.execPath, [workerScript, root], {
    env: {
      ...process.env,
      CRUX_RUNTIME_WORKER_OWNERSHIP_MARKER: ownershipMarker,
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<{
    readonly code: number | null;
    readonly signal: NodeJS.Signals | null;
  }>((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  return { child, exited, ownershipMarker, stderr: () => stderr };
}

export async function exitOf(worker: WorkerProcess): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}> {
  return { ...(await worker.exited), stderr: worker.stderr() };
}

export async function waitForOwnership(worker: WorkerProcess): Promise<void> {
  await expect
    .poll(
      async () => {
        if (worker.child.exitCode !== null) {
          throw new Error(
            `worker exited ${worker.child.exitCode}: ${worker.stderr()}`,
          );
        }
        return await access(worker.ownershipMarker).then(
          () => true,
          () => false,
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

export async function stopWorker(worker: WorkerProcess): Promise<void> {
  if (worker.child.exitCode === null && worker.child.signalCode === null)
    worker.child.kill("SIGKILL");
  await worker.exited;
}

export async function runApplication(
  fixture: RuntimeWorkerProjectFixture,
  operation: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const child = spawn(
    process.execPath,
    [
      join(fixture.root, "application-bundle.mjs"),
      operation,
      JSON.stringify(input),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exit = await new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  if (exit.code !== 0) {
    throw new Error(
      `Application process exited ${String(exit.code)} (${String(exit.signal)}): ${stderr}`,
    );
  }
  const line = stdout.trim().split("\n").at(-1);
  if (!line) throw new Error(`Application process returned no JSON: ${stderr}`);
  return JSON.parse(line) as Record<string, unknown>;
}

export async function expireWorkLease(
  fixture: RuntimeWorkerProjectFixture,
  workId: string,
): Promise<void> {
  const pool = createPostgresTestPool(fixture.url);
  try {
    await pool.query(
      `UPDATE "${fixture.schema}"."leases" SET expires_at = NOW() - INTERVAL '1 second' WHERE resource = $1`,
      [`work:${workId}`],
    );
  } finally {
    await pool.end();
  }
}
