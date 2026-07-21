#!/usr/bin/env node

/**
 * Static Index parity gate for CI and release checks.
 *
 * The gate builds the Rust/Oxc worker first and then passes its absolute path
 * to every parity command. It also builds and embeds the Node worker bundle
 * before Go host tests, which mirrors the fresh-checkout CI path instead of
 * relying on locally generated assets.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
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
 * }>} ParityCommand
 */

/** Environment passed to every worker-backed parity command. */
const workerEnv = {
  CRUX_STATIC_INDEX_WORKER: workerPath,
};

/** Environment that turns Go env-gated parity tests from local skips into CI failures. */
const requiredGoParityEnv = {
  ...workerEnv,
  CRUX_INDEXER_PARITY_ROOT: repoRoot,
  CRUX_INDEXER_PARITY_REQUIRED: "1",
};

/** Environment that compares Rust/Oxc output against the captured Rust static golden. */
const requiredRustStaticGoldenEnv = {
  ...workerEnv,
  CRUX_RUST_FIRST_PARTY_STATIC_GOLDEN_REQUIRED: "1",
};

/** @type {readonly ParityCommand[]} */
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
    label: "Run Rust Static Index tests",
    command: "cargo",
    args: ["test"],
  },
  {
    label: "Verify Rust first-party static output against Rust golden",
    command: "pnpm",
    args: [
      "--filter",
      "@use-crux/indexer",
      "exec",
      "vitest",
      "run",
      "__tests__/rust-first-party-static-golden.test.ts",
    ],
    env: requiredRustStaticGoldenEnv,
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
    label: 'Run Go Project Index parity packages',
    command: 'go',
    // The production parity test indexes repoRoot and clears .crux/cache/index;
    // keep Go packages serial so adjacent package tests cannot churn that cache.
    args: ['test', '-p', '1', './internal/projectindex/...', '-count=1'],
    cwd: localPackageRoot,
    env: requiredGoParityEnv,
  },
];

for (const item of commands) {
  run(item);
  if (item.label === "Build Rust/Oxc Static Index worker") assertWorkerExists();
}

/**
 * Runs one parity command with inherited stdio.
 *
 * @param {ParityCommand} item - Command descriptor to execute.
 */
function run(item) {
  console.log(`\n==> ${item.label}`);
  const result = spawnSync(item.command, item.args, {
    cwd: item.cwd ?? repoRoot,
    env: { ...process.env, ...item.env },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** Throws if the Rust worker build did not produce the binary used by parity tests. */
function assertWorkerExists() {
  if (existsSync(workerPath)) return;
  throw new Error(
    `Static Index parity gate expected Rust worker at ${workerPath}`,
  );
}
