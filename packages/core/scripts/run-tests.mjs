#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitestCli = fileURLToPath(
  new URL("../node_modules/vitest/vitest.mjs", import.meta.url),
);
export const isolatedTests = [
  "__tests__/eval/node-run.test.ts",
  "__tests__/eval/review-writer.test.ts",
];

export function createTestPhases(passthroughArgs) {
  return [
    [
      "run",
      ...isolatedTests.flatMap((path) => ["--exclude", path]),
      ...passthroughArgs,
    ],
    ...isolatedTests.map((path) => ["run", path, ...passthroughArgs]),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const args of createTestPhases(process.argv.slice(2))) {
    runVitest(args);
  }
}

function runVitest(args) {
  const result = spawnSync(process.execPath, [vitestCli, ...args], {
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
