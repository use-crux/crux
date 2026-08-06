import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(scriptRoot, "../fixtures/demo-project");
const seedScript = join(scriptRoot, "seed-demo.sh");

test("seed-demo replays one deterministic V5 batch and installs the Eval matrix", async () => {
  const projectRoot = await copyFixture();
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/api/stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      method: request.method,
      path: request.url,
      body: Buffer.concat(chunks).toString("utf8"),
    });
    response.writeHead(202, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        dispositions: JSON.parse(requests.at(-1).body).records.map((record) => ({
          recordId: record.recordId,
          outcome: "accepted",
          retryable: false,
        })),
      }),
    );
  });
  const port = await listen(server);

  try {
    const first = await runSeed(projectRoot, ["--port", String(port)]);
    const second = await runSeed(projectRoot, ["--port", String(port)]);

    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);
    assert.match(first.stdout, /Demo data accepted/);
    assert.deepEqual(
      requests.map(({ method, path }) => ({ method, path })),
      [
        { method: "POST", path: "/api/observability/records" },
        { method: "POST", path: "/api/observability/records" },
      ],
    );
    assert.equal(requests[0].body, requests[1].body);

    const batch = JSON.parse(requests[0].body);
    assert.equal(batch.schemaVersion, 5);
    assert.equal(batch.records.length, 50);
    assert.ok(batch.records.every((record) => record.schemaVersion === 5));
    assert.equal(
      new Set(batch.records.map((record) => record.recordId)).size,
      batch.records.length,
    );
    assert.deepEqual(
      new Set(
        batch.records
          .filter((record) => record.type === "run:end")
          .map((record) => record.status),
      ),
      new Set(["ok", "error"]),
    );
    assert.ok(batch.records.some((record) => record.type === "run:suspend"));
    assert.ok(
      new Set(
        batch.records
          .filter((record) => record.type === "run:start")
          .map((record) => record.runId),
      ).size >= 5,
    );
    assert.deepEqual(
      new Set(
        batch.records
          .filter(
            (record) =>
              record.type === "run:start" &&
              record.runId === record.operationId,
          )
          .map((record) => record.sessionId),
      ),
      new Set(["session_demo_support", "session_demo_billing"]),
    );
    assert.ok(
      batch.records.some(
        (record) =>
          record.recordId === "demo_flow_child_end" &&
          record.operationId === "run_demo_refund_flow" &&
          record.status === "error",
      ),
    );
    assert.ok(
      batch.records.filter(
        (record) =>
          record.runId === "run_demo_support_regression" &&
          (record.type === "span" || record.type === "span:start"),
      ).length >= 10,
    );

    const evalRun = JSON.parse(
      await readFile(
        join(
          projectRoot,
          ".crux/evals/runs/eval-run-demo-support-v4.json",
        ),
        "utf8",
      ),
    );
    assert.equal(evalRun.schemaVersion, 4);
    assert.equal(evalRun.evalId, "demo.support-quality");
    assert.deepEqual(evalRun.selection.cases, [
      "refund-window",
      "unsupported-exception",
      "account-lockout",
    ]);
    assert.deepEqual(evalRun.selection.variants, ["current", "concise"]);
    assert.equal(evalRun.cells.length, 6);
    assert.deepEqual(
      new Set(evalRun.cells.map((cell) => cell.status)),
      new Set(["passed", "failed", "skipped"]),
    );
    assert.ok(
      evalRun.cells.some(
        (cell) =>
          cell.task.status === "reused" &&
          cell.task.reason === "exact_evidence" &&
          cell.task.evidenceFingerprint &&
          cell.task.evidenceRef,
      ),
    );
    assert.ok(
      evalRun.cells.some(
        (cell) =>
          cell.status === "failed" &&
          cell.runIds.includes("run_demo_support_regression"),
      ),
    );

    const baseline = JSON.parse(
      await readFile(join(projectRoot, "evals/support.baseline.json"), "utf8"),
    );
    assert.equal(baseline.runId, evalRun.runId);
    assert.equal(baseline.selectedArm, "current");
    assert.equal(baseline.coverage.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("seed-demo reports HTTP and disposition failures clearly", async () => {
  const projectRoot = await copyFixture();
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("{}");
      return;
    }
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("demo service unavailable");
  });
  const port = await listen(server);

  try {
    const result = await runSeed(projectRoot, ["--port", String(port)]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Failed to seed Crux Local/);
    assert.match(result.stderr, /503/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("seed-demo documents port 4466 and rejects invalid ports", async () => {
  const projectRoot = await copyFixture();
  const help = await runSeed(projectRoot, ["--help"]);
  const invalid = await runSeed(projectRoot, ["--port", "nope"]);

  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /default: 4466/);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /port must be an integer from 1 to 65535/);
});

test("the committed Baseline uses the current versioned fingerprint contract", async () => {
  const baseline = JSON.parse(
    await readFile(join(fixtureRoot, "evals/support.baseline.json"), "utf8"),
  );
  const { snapshotFingerprint, ...material } = baseline;

  assert.equal(baseline.schemaVersion, 3);
  assert.equal(baseline.baselineFingerprintEpoch, 5);
  assert.equal(
    snapshotFingerprint,
    createHash("sha256")
      .update(JSON.stringify(encodeFingerprintValue(material)))
      .digest("hex"),
  );
  const expectedFingerprint = fingerprintValue({
    citations: ["policy-refunds"],
  });
  assert.deepEqual(
    baseline.coverage
      .filter((entry) => entry.expectedFingerprint !== expectedFingerprint)
      .map((entry) => entry.caseId),
    ["unsupported-exception"],
  );
});

async function copyFixture() {
  const root = await mkdtemp(join(tmpdir(), "crux-demo-seed-"));
  await cp(fixtureRoot, root, {
    recursive: true,
    filter: (source) => basename(source) !== ".crux",
  });
  return root;
}

function encodeFingerprintValue(value) {
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    return ["number", Object.is(value, -0) ? "-0" : value];
  }
  if (Array.isArray(value)) {
    return ["array", value.map(encodeFingerprintValue), []];
  }
  if (typeof value === "object") {
    return [
      "object",
      Object.keys(value)
        .sort()
        .map((key) => [key, encodeFingerprintValue(value[key])]),
    ];
  }
  throw new TypeError(`Unsupported Baseline value: ${typeof value}`);
}

function fingerprintValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(encodeFingerprintValue(value)))
    .digest("hex");
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function runSeed(projectRoot, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [seedScript, ...args], {
      cwd: projectRoot,
      env: { ...process.env, NO_COLOR: "1" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}
