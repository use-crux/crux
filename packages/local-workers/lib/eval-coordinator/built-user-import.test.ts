import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const BUILT_COORDINATOR = resolve(__dirname, "../../dist/eval-coordinator.mjs");
const CORE_PACKAGE = resolve(__dirname, "../../../core");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("built Eval coordinator user imports", () => {
  it("loads and executes authored TypeScript without a project tsx dependency", async () => {
    const root = await fixtureProject();

    const listed = await runCoordinator(root, ["--list"]);
    expect(listed.code, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('"id":"loader"');

    const executed = await runCoordinator(root, [
      "loader",
      "--confirm-unknown-cost",
    ]);
    expect(executed.code, JSON.stringify(executed)).toBe(0);
    expect(executed.stdout).toContain('"type":"eval:done"');
    expect(executed.stdout).toContain('"passed":true');
    const runFiles = await readdir(join(root, ".crux/evals/runs"));
    const persisted = await readFile(
      join(root, ".crux/evals/runs", runFiles[0]!),
      "utf8",
    );
    expect(JSON.parse(persisted)).toMatchObject({
      cells: [{ input: { secret: "[redacted]" } }],
    });
    expect(persisted).not.toContain("private-value");
  }, 60_000);
});

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "crux-built-eval-import-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(root, "crux.config.ts"),
    [
      'import { config } from "@use-crux/core"',
      "export default config({",
      "  observability: { redactPaths: ['secret'] },",
      "})",
    ].join("\n"),
  );
  await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
  await symlink(CORE_PACKAGE, join(root, "node_modules/@use-crux/core"), "dir");
  await mkdir(join(root, "node_modules/react"), { recursive: true });
  await writeFile(
    join(root, "node_modules/react/package.json"),
    JSON.stringify({
      type: "module",
      exports: { "./jsx-runtime": "./jsx-runtime.js" },
    }),
  );
  await writeFile(
    join(root, "node_modules/react/jsx-runtime.js"),
    "export const jsx = (type, props) => ({ type, props })\n",
  );
  await mkdir(join(root, "evals"), { recursive: true });
  await writeFile(
    join(root, "evals/support.tsx"),
    [
      "export enum Tone { Helpful = 'helpful' }",
      "export namespace Defaults { export const tone = Tone.Helpful }",
      "class Prefix { constructor(public readonly value: string) {} }",
      "const marker = <span data-crux='loaded' />",
      "void marker",
      "export const prefix = new Prefix(Defaults.tone).value",
    ].join("\n"),
  );
  await writeFile(
    join(root, "evals/loader.eval.ts"),
    [
      'import { evaluate } from "@use-crux/core/eval"',
      'import { prefix } from "./support"',
      "const task = async (input: { question: string; secret: string }) => ({",
      "  answer: `${prefix}:${input.question}` ,",
      "})",
      "export default evaluate({",
      "  id: 'loader',",
      "  task,",
      "  cases: [{ id: 'hello', input: { question: 'hello', secret: 'private-value' } }],",
      "})",
    ].join("\n"),
  );
  return root;
}

async function runCoordinator(
  cwd: string,
  args: readonly string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [BUILT_COORDINATOR, ...args], {
      cwd,
      env: { ...process.env, NODE_PATH: undefined },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}
