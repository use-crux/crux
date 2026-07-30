import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestEvalHost } from "./test-host";
import { registerEvalCatalogTimeoutBehavior } from "./catalog-timeout.behavior";

const require = createRequire(import.meta.url);
const tsx = require.resolve("tsx/cli");
const coordinator = resolve(__dirname, "../../bin/eval-coordinator.ts");
const project = resolve(__dirname, "../__fixtures__/eval-project");
describe("Eval coordinator", { timeout: 120_000 }, () => {
  registerEvalCatalogTimeoutBehavior(run);
  it("adds and rediscovers one canonical Review sidecar Case", async () => {
    const sidecar = resolve(project, "evals/managed.cases.jsonl");
    await rm(sidecar, { force: true });
    const result = await runWithInput(["--review-add"], {
      evalId: "managed",
      id: "review-refund",
      input: { question: "reviewed" },
      reviewId: "review_1",
      runId: "run_1",
      repositoryWritable: true,
      redactPaths: ["question"],
    });
    expect(result.code, result.stderr).toBe(0);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "review:add",
        result: expect.objectContaining({
          status: "added",
          caseId: "review-refund",
        }),
      }),
    ]);
    const persisted = await readFile(sidecar, "utf8");
    expect(persisted).toContain('"reviewId":"review_1"');
    expect(persisted).toContain('"question":"[redacted]"');
    expect(persisted).not.toContain("reviewed");
    const listed = await run(["--list"]);
    expect(listed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "collect:done",
          evals: expect.arrayContaining([
            expect.objectContaining({
              id: "managed",
              cases: expect.arrayContaining([
                expect.objectContaining({ id: "review-refund" }),
              ]),
            }),
          ]),
        }),
      ]),
    );
    await rm(sidecar, { force: true });
  });
  it("discovers one default Eval and emits a clean list stream", async () => {
    const result = await run(["--list"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "collect:done",
          evals: expect.arrayContaining([
            expect.objectContaining({
              id: "support",
              definitionFingerprint: expect.any(String),
              cases: [
                { id: "refund", origin: "evals/support.eval.ts:inline:1" },
              ],
            }),
            expect.objectContaining({
              id: "managed",
              caseFiles: ["evals/fixtures/managed.json"],
            }),
          ]),
          errors: [],
        }),
        { type: "run:done", exitCode: 0, runIds: [] },
      ]),
    );
  });

  it("reports discovered host requirements and real catalog readiness", async () => {
    const result = await run(["--catalog-readiness"]);
    expect(result.code, result.stderr).toBe(0);
    const collected = result.events.find(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "collect:done",
    ) as { evals: readonly Record<string, unknown>[] } | undefined;
    expect(collected?.evals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "support",
          requiredHostCapabilities: [],
          hostReadiness: expect.objectContaining({ status: "ready" }),
        }),
        expect.objectContaining({
          id: "remote",
          requiredHostCapabilities: ["record-store"],
          hostReadiness: expect.objectContaining({
            status: "setup-required",
            reason: "connection_unavailable",
          }),
        }),
      ]),
    );
  });

  it("plans exact actions without executing or writing a run", async () => {
    const result = await run(["support", "--plan"]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "eval:plan", evalId: "support" }),
        expect.objectContaining({ type: "run:done", exitCode: 0, runIds: [] }),
      ]),
    );
  });

  it("executes an admitted managed task and reuses its exact evidence", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    const first = await run(["managed", "--confirm-unknown-cost"]);
    expect(first.code, first.stderr).toBe(0);
    expect(first.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:done",
          run: expect.objectContaining({
            status: "complete",
            passed: true,
            cells: expect.arrayContaining([
              expect.objectContaining({
                task: expect.objectContaining({ status: "executed" }),
              }),
            ]),
          }),
        }),
      ]),
    );

    const second = await run(["managed"]);
    expect(second.code, second.stderr).toBe(0);
    expect(second.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:done",
          run: expect.objectContaining({
            cells: expect.arrayContaining([
              expect.objectContaining({
                task: expect.objectContaining({ status: "reused" }),
              }),
            ]),
          }),
        }),
      ]),
    );
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
  });

  it("plans unverified required-host work but blocks execution before a request", async () => {
    const environment = cleanHostEnvironment({
      CRUX_EVAL_HOST_URL: "http://127.0.0.1:1",
      CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
    });

    const planned = await run(["remote", "--plan"], environment);
    expect(planned.code, planned.stderr).toBe(0);
    expect(planned.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:plan",
          plan: expect.objectContaining({
            hostReadiness: expect.objectContaining({
              status: "unverified",
              remedies: ["Set CRUX_EVAL_HOST_TOKEN."],
            }),
          }),
        }),
      ]),
    );

    const executed = await run(
      ["remote", "--confirm-unknown-cost"],
      environment,
    );
    expect(executed.code).toBe(2);
    expect(executed.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          scope: "host",
          message: expect.stringContaining("CRUX_EVAL_HOST_TOKEN"),
        }),
      ]),
    );
  });

  it("preflights every selected Eval before executing any of them", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    const result = await run(
      ["managed", "remote", "--confirm-unknown-cost"],
      cleanHostEnvironment({
        CRUX_EVAL_HOST_URL: "http://127.0.0.1:1",
        CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
      }),
    );

    expect(result.code).toBe(2);
    await expect(
      access(resolve(project, ".crux", "evals", "runs")),
    ).rejects.toThrow();
  });

  it("reports transport-unverified plans without exposing the bearer", async () => {
    const token = "transport-secret-must-not-escape";
    const environment = cleanHostEnvironment({
      CRUX_EVAL_HOST_URL: "http://127.0.0.1:1",
      CRUX_EVAL_HOST_DEPLOYMENT_ID: "production",
      CRUX_EVAL_HOST_TOKEN: token,
    });

    const planned = await run(["remote", "--plan"], environment);
    expect(planned.code, planned.stderr).toBe(0);
    expect(planned.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:plan",
          plan: expect.objectContaining({
            hostReadiness: expect.objectContaining({
              status: "unverified",
              reason: "transport",
            }),
          }),
        }),
      ]),
    );
    expect(JSON.stringify(planned.events)).not.toContain(token);

    const executed = await run(
      ["remote", "--confirm-unknown-cost"],
      environment,
    );
    expect(executed.code).toBe(2);
    expect(JSON.stringify(executed.events)).not.toContain(token);
  });

  it("verifies once, executes remote cells, then reuses evidence without reconnecting", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    const host = await startTestEvalHost(project);
    const environment = hostEnvironment(host);
    const first = await run(["remote", "--confirm-unknown-cost"], environment);
    expect(first.code, first.stderr).toBe(0);
    expect(host.requests).toEqual({ manifest: 1, jobs: 2 });
    expect(first.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:done",
          run: expect.objectContaining({
            cells: expect.arrayContaining([
              expect.objectContaining({
                task: expect.objectContaining({ status: "executed" }),
              }),
            ]),
          }),
        }),
      ]),
    );
    const firstDone = first.events.find(
      (
        event,
      ): event is {
        type: "eval:done";
        run: { cells: Array<{ runIds: string[] }> };
      } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "eval:done",
    );
    const fresh = await run(
      ["remote", "--fresh", "--confirm-unknown-cost"],
      environment,
    );
    expect(
      fresh.code,
      fresh.stderr || JSON.stringify(fresh.events, undefined, 2),
    ).toBe(0);
    const freshDone = fresh.events.find(
      (
        event,
      ): event is {
        type: "eval:done";
        run: { cells: Array<{ runIds: string[] }> };
      } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "eval:done",
    );
    expect(freshDone?.run.cells[0]?.runIds).not.toEqual(
      firstDone?.run.cells[0]?.runIds,
    );
    expect(host.requests).toEqual({ manifest: 2, jobs: 4 });
    await host.close();

    const requestsBeforeAllHit = { ...host.requests };
    const second = await run(
      ["remote"],
      cleanHostEnvironment({
        CRUX_EVAL_HOST_DEPLOYMENT_ID: host.deploymentId,
      }),
    );
    expect(second.code, second.stderr).toBe(0);
    expect(host.requests).toEqual(requestsBeforeAllHit);
    expect(second.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "eval:plan",
          plan: expect.objectContaining({
            hostReadiness: expect.objectContaining({ status: "local" }),
          }),
        }),
      ]),
    );
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
  }, 60_000);

  it("confirms unknown cost in the same invocation that executes planned work", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });

    const result = await runWithTextInput(
      ["managed", "--request-unknown-cost-confirmation"],
      "yes\n",
      cleanHostEnvironment(),
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "cost:confirmation-required" }),
        expect.objectContaining({ type: "eval:done", evalId: "managed" }),
      ]),
    );
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
  });

  it("keeps offline planning network-free and rejects proven deployment mismatch", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    const privacyDirectory = resolve(project, ".crux/generated/runtime");
    await mkdir(privacyDirectory, { recursive: true });
    await writeFile(
      resolve(privacyDirectory, "privacy.json"),
      JSON.stringify({
        schemaVersion: 1,
        privacyFingerprint:
          "d2b7a3a9e0d3857b24b871ee585d118490dabd9edf81bcf10de9f5328e85cc29",
        redactPaths: [],
      }),
    );
    const host = await startTestEvalHost(project);
    const environment = hostEnvironment(host);

    const offline = await run(["remote", "--offline", "--plan"], environment);
    expect(offline.code, offline.stderr).toBe(0);
    expect(host.requests).toEqual({ manifest: 0, jobs: 0 });

    const offlineExecution = await run(["remote", "--offline"], environment);
    expect(offlineExecution.code).toBe(2);
    expect(host.requests).toEqual({ manifest: 0, jobs: 0 });

    const mismatch = await run(
      ["remote", "--plan"],
      cleanHostEnvironment({
        CRUX_EVAL_HOST_URL: host.url,
        CRUX_EVAL_HOST_DEPLOYMENT_ID: "different-deployment",
        CRUX_EVAL_HOST_TOKEN: host.token,
      }),
    );
    expect(mismatch.code).toBe(2);
    expect(host.requests).toEqual({ manifest: 1, jobs: 0 });
    expect(JSON.stringify(mismatch.events)).not.toContain(host.token);
    await host.close();
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
  }, 60_000);

  it("refuses to promote a Case-filtered run", async () => {
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    const execution = await run([
      "managed",
      "--case",
      "hello",
      "--confirm-unknown-cost",
    ]);
    expect(execution.code, execution.stderr).toBe(0);
    const completed = execution.events.find(
      (event): event is { type: "eval:done"; run: { runId: string } } =>
        typeof event === "object" &&
        event !== null &&
        (event as { type?: unknown }).type === "eval:done",
    );
    expect(completed).toBeDefined();

    const promotion = await run(["--baseline-set", completed!.run.runId]);
    expect(promotion.code).toBe(2);
    expect(promotion.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "error",
          scope: "collect",
          message: expect.stringMatching(/filtered/i),
        }),
      ]),
    );
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
  });

  it("requires explicit acceptance before promoting a failing run", async () => {
    const source = resolve(project, "evals/failing.eval.ts");
    const baseline = resolve(project, "evals/failing.baseline.json");
    await rm(resolve(project, ".crux"), { recursive: true, force: true });
    await writeFile(
      source,
      [
        'import { evaluate } from "@use-crux/core/eval"',
        "export default evaluate({",
        "  task: async (input: string) => input,",
        "  cases: [{ id: 'failure', input: 'actual' }],",
        "  expect: ({ output, expect }) => expect(output).toBe('expected'),",
        "})",
      ].join("\n"),
    );
    try {
      const execution = await run(["failing", "--confirm-unknown-cost"]);
      const completed = execution.events.find(
        (event): event is { type: "eval:done"; run: { runId: string } } =>
          typeof event === "object" &&
          event !== null &&
          (event as { type?: unknown }).type === "eval:done",
      );
      expect(completed).toBeDefined();

      const refused = await run(["--baseline-set", completed!.run.runId]);
      expect(refused.code).toBe(2);
      expect(refused.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "error",
            scope: "baseline",
            message: expect.stringMatching(/--accept-failing/),
          }),
        ]),
      );

      const accepted = await run([
        "--baseline-set",
        completed!.run.runId,
        "--accept-failing",
      ]);
      expect(accepted.code, accepted.stderr).toBe(0);
      expect(accepted.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "baseline:done",
            path: "evals/failing.baseline.json",
          }),
        ]),
      );
      expect(JSON.stringify(accepted.events)).not.toContain(project);
    } finally {
      await rm(source, { force: true });
      await rm(baseline, { force: true });
      await rm(resolve(project, ".crux"), { recursive: true, force: true });
    }
  });
});
function run(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; events: unknown[]; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsx, coordinator, ...args], {
      cwd: project,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({
        code: code ?? -1,
        events: stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown),
        stderr,
      });
    });
  });
}

function runWithInput(
  args: readonly string[],
  input: unknown,
): Promise<{ code: number; events: unknown[]; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsx, coordinator, ...args], {
      cwd: project,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({
        code: code ?? -1,
        events: stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown),
        stderr,
      });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function runWithTextInput(
  args: readonly string[],
  input: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ code: number; events: unknown[]; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [tsx, coordinator, ...args], {
      cwd: project,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      resolveRun({
        code: code ?? -1,
        events: stdout
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown),
        stderr,
      });
    });
    child.stdin.write(input);
  });
}

function cleanHostEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.CRUX_EVAL_HOST_URL;
  delete environment.CRUX_EVAL_HOST_DEPLOYMENT_ID;
  delete environment.CRUX_EVAL_HOST_TOKEN;
  return { ...environment, ...overrides };
}

function hostEnvironment(host: {
  readonly url: string;
  readonly deploymentId: string;
  readonly token: string;
}): NodeJS.ProcessEnv {
  return cleanHostEnvironment({
    CRUX_EVAL_HOST_URL: host.url,
    CRUX_EVAL_HOST_DEPLOYMENT_ID: host.deploymentId,
    CRUX_EVAL_HOST_TOKEN: host.token,
  });
}
