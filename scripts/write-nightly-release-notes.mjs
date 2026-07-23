#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { nightlyReleaseNotes } from "./release/release-notes.mjs";

const options = parseArgs(process.argv.slice(2));
const version = required(options, "version");
const sourceCommit = required(options, "source-commit");
const out = resolve(options.out ?? ".tmp/github-nightly-release-notes.md");
await mkdir(dirname(out), { recursive: true });
await writeFile(
  out,
  nightlyReleaseNotes({ version, sourceCommit }),
);
console.log(out);

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") printHelpAndExit();
    if (!arg.startsWith("--") || index + 1 >= args.length)
      throw new Error(`Invalid argument: ${arg}`);
    options[arg.slice(2)] = args[++index];
  }
  return options;
}

function printHelpAndExit() {
  console.log(`Usage: node scripts/write-nightly-release-notes.mjs [options]

  --version <value>       Nightly version (required)
  --source-commit <sha>   Immutable source commit (required)
  --out <path>            Notes file (default: .tmp/github-nightly-release-notes.md)
`);
  process.exit(0);
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}
