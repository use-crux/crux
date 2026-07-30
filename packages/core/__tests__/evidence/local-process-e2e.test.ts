import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createHttpObservabilityTransport,
  evidence,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from "../../src";
import { emitToolCallArgsArtifact } from "../../src/adapter/tool/emission";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
let fixtureRoot = "";
let localBinary = "";
const activeStops = new Set<() => Promise<void>>();

describe("Core to Local execution evidence", () => {
  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "crux-evidence-core-local-"));
    localBinary = join(fixtureRoot, "localserver.test");
    await withLocalCompileAssets(() =>
      execFileAsync(
        "go",
        [
          "test",
          "-c",
          "-o",
          localBinary,
          "./internal/localserver",
        ],
        { cwd: join(repositoryRoot, "packages/local") },
      ),
    );
  }, 120_000);

  afterEach(async () => {
    await Promise.all([...activeStops].map((stop) => stop()));
    resetObservabilityRuntime();
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("authors, flushes, restarts, inspects, and rejects a durable conflict", async () => {
    const database = join(fixtureRoot, "evidence.sqlite");
    const first = await startLocalProcess(database, "2026-07-30T09:00:00Z");
    const subject = authorEvidence(first.baseUrl);
    const initialFlush = await observe.flush();
    expect(initialFlush).toMatchObject({
      status: "drained",
      rejected: 0,
    });
    const initial = await inspectSubject(subject);
    expect(initial.roles.intent).toMatchObject({
      status: "present",
      records: [
        {
          ref: { evidenceKind: "tool.args" },
          payloadState: "reference",
        },
      ],
    });
    expect(initial.roles.verification).toMatchObject({
      status: "present",
      conclusion: "passed",
      records: [{ data: { reviewed: true } }],
    });

    await first.stop();
    resetObservabilityRuntime();
    const second = await startLocalProcess(database, "2026-07-30T09:05:00Z");
    setObservabilityTransport(
      createHttpObservabilityTransport({ serverUrl: second.baseUrl }),
    );
    const restarted = await inspectSubject(subject);
    expect(restarted).toMatchObject({
      subject: initial.subject,
      source: initial.source,
    });
    expect(restarted.roles).toEqual(initial.roles);

    evidence.record({
      subject,
      role: "verification",
      conclusion: "failed",
      kind: "custom.local-process-review",
      data: { reviewed: false },
      idempotencyKey: "local-process-review",
    });
    await expect(observe.flush()).resolves.toMatchObject({
      status: "drained",
      rejected: 2,
    });
    const afterConflict = await inspectSubject(subject);
    expect(afterConflict.roles).toEqual(initial.roles);
    await second.stop();
  }, 120_000);
});

function authorEvidence(baseUrl: string) {
  setObservabilityTransport(createHttpObservabilityTransport({ serverUrl: baseUrl }));
  const run = observe.openRun({
    name: "core-local evidence",
    rootPrimitive: "custom.operation",
  });
  let subject: { kind: "execution"; id: string } | undefined;
  run.withContext(() => {
    const span = observe.openSpan({
      name: "review",
      primitive: "tool.call",
    });
    const exactSubject = { kind: "execution", id: span.spanId } as const;
    subject = exactSubject;
    span.withContext(() => {
      emitToolCallArgsArtifact(
        span.spanId,
        "review",
        "call_core_local",
        { query: "safe" },
      );
      evidence.record({
        subject: exactSubject,
        role: "verification",
        conclusion: "passed",
        kind: "custom.local-process-review",
        data: { reviewed: true },
        idempotencyKey: "local-process-review",
      });
    });
    span.end({ status: "ok" });
  });
  run.end({ status: "ok" });
  if (!subject) throw new Error("missing authored evidence subject");
  return subject;
}

function inspectSubject(subject: { kind: "execution"; id: string }) {
  return evidence.inspect(subject, {
    includeData: true,
    includeHistory: true,
    limit: 50,
  });
}

async function startLocalProcess(
  database: string,
  now: string,
): Promise<{ baseUrl: string; stop: () => Promise<void> }> {
  const ready = join(fixtureRoot, `ready-${crypto.randomUUID()}`);
  let logs = "";
  const child = spawn(
    localBinary,
    ["-test.run=^TestEvidenceCanonicalRestartProcess$", "-test.v"],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CRUX_EVIDENCE_E2E_CHILD: "1",
        CRUX_EVIDENCE_E2E_DB: database,
        CRUX_EVIDENCE_E2E_NOW: now,
        CRUX_EVIDENCE_E2E_READY: ready,
        CRUX_EVIDENCE_RETENTION_DAYS: "2",
        CRUX_EVIDENCE_PAYLOAD_RETENTION_DAYS: "1",
        CRUX_OBSERVABILITY_RETENTION_DAYS: "14",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    logs += chunk.toString();
  });
  const baseUrl = await waitForReadyFile(ready, child, () => logs);
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    activeStops.delete(stop);
    child.kill("SIGINT");
    const code = await childExit(child);
    if (code !== 0) {
      throw new Error(`Local evidence child exited ${code}:\n${logs}`);
    }
  };
  activeStops.add(stop);
  return { baseUrl, stop };
}

async function waitForReadyFile(
  ready: string,
  child: ChildProcess,
  logs: () => string,
): Promise<string> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Local evidence child exited early:\n${logs()}`);
    }
    try {
      const value = await readFile(ready, "utf8");
      if (value) return value;
    } catch {
      // The child creates the readiness file only after listening.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  child.kill("SIGINT");
  throw new Error(`Local evidence child did not become ready:\n${logs()}`);
}

function childExit(child: ChildProcess): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolveExit) => {
    child.once("exit", resolveExit);
  });
}

async function withLocalCompileAssets<T>(run: () => Promise<T>): Promise<T> {
  const created: string[] = [];
  try {
    for (const [relativePath, contents] of localCompileAssetPlaceholders) {
      const path = join(repositoryRoot, relativePath);
      try {
        await writeFile(path, contents, { flag: "wx" });
        created.push(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    return await run();
  } finally {
    await Promise.all(created.map((path) => rm(path, { force: true })));
  }
}

const localCompileAssetPlaceholders = [
  [
    "packages/local/internal/assets/embed/eval-coordinator.mjs",
    "export {};\n",
  ],
  [
    "packages/local/internal/assets/embed/source-resolver.mjs",
    "export {};\n",
  ],
  [
    "packages/local/internal/assets/embed/project-indexer.mjs",
    "export {};\n",
  ],
  [
    "packages/local/internal/assets/embed/project-semantic-indexer.mjs",
    "export {};\n",
  ],
  [
    "packages/local/internal/assets/embed/project-runtime-indexer.mjs",
    "export {};\n",
  ],
  [
    "packages/local/internal/assets/ui-embed/index.html",
    "<!doctype html>\n",
  ],
] as const;
