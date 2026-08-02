#!/usr/bin/env node

/**
 * Static Index contract gate for CI and release checks.
 *
 * The gate builds the Rust/Oxc worker first and passes its absolute path to
 * worker-backed contract tests. It also builds and embeds the Node worker
 * bundle before Go host tests, matching the fresh-checkout CI path.
 *
 * @module
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(
  repoRoot,
  "target",
  "debug",
  process.platform === "win32"
    ? "crux-static-index-worker.exe"
    : "crux-static-index-worker",
);
const localPackageRoot = resolve(repoRoot, "packages", "local");

/**
 * @typedef {Readonly<{
 *   label: string
 *   command: string
 *   args: readonly string[]
 *   cwd?: string
 *   env?: Readonly<Record<string, string>>
 * }>} ContractCommand
 */

const workerEnv = { CRUX_STATIC_INDEX_WORKER: workerPath };
const requiredGoParityEnv = {
  ...workerEnv,
  CRUX_INDEXER_PARITY_ROOT: repoRoot,
  CRUX_INDEXER_PARITY_REQUIRED: "1",
};
const requiredRepositoryContractEnv = {
  ...workerEnv,
  CRUX_STATIC_INDEX_CONTRACTS_REQUIRED: "1",
};

/** @type {readonly ContractCommand[]} */
const commands = [
  {
    label: "Build Rust/Oxc Static Index worker",
    command: "cargo",
    args: [
      "build",
      "--package",
      "crux-static-index-worker",
      "--bin",
      "crux-static-index-worker",
    ],
  },
  {
    label: "Run Rust Static Index contract tests",
    command: "cargo",
    args: ["test"],
  },
  {
    label: "Verify first-party repository static invariants",
    command: "pnpm",
    args: [
      "--filter",
      "@use-crux/indexer",
      "exec",
      "vitest",
      "run",
      "__tests__/rust-first-party-repository-invariants.test.ts",
    ],
    env: requiredRepositoryContractEnv,
  },
  {
    label: "Run full indexer suite with Rust worker",
    command: "pnpm",
    args: ["--filter", "@use-crux/indexer", "test"],
    env: workerEnv,
  },
  {
    label: "Build local worker bundle for Go host tests",
    command: "pnpm",
    args: ["--filter", "@use-crux/local-workers", "build"],
  },
  {
    label: "Embed local workers for Go host tests",
    command: "make",
    args: ["embed-workers"],
    cwd: localPackageRoot,
  },
  {
    label: "Run Go Project Index parity packages",
    command: "go",
    args: ["test", "-p", "1", "./internal/projectindex/...", "-count=1"],
    cwd: localPackageRoot,
    env: requiredGoParityEnv,
  },
];

for (const item of commands) {
  run(item);
  if (item.label === "Build Rust/Oxc Static Index worker") assertWorkerExists();
}

/** Runs one contract command with inherited stdio. */
function run(item) {
  console.log(`\n==> ${item.label}`);
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd ?? repoRoot,
    env: { ...process.env, ...item.env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

/** Throws if the worker build did not produce the required binary. */
function assertWorkerExists() {
  if (existsSync(workerPath)) return;
  throw new Error(`Static Index contract gate expected Rust worker at ${workerPath}`);
}
