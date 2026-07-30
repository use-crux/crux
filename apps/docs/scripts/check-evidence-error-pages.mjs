import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evidenceAggregateHealthCodes,
  evidenceErrorRegistry,
} from "./evidence-error-registry.mjs";

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const errorsDir = path.join(
  docsRoot,
  "apps/docs/content/docs/errors",
);
const coreErrorsPath = path.join(
  docsRoot,
  "packages/core/src/evidence/errors.ts",
);
const coreErrors = await readFile(coreErrorsPath, "utf8");
const typeBlock = coreErrors.match(
  /export type CruxEvidenceErrorCode =([\s\S]*?);\n/,
)?.[1];
if (!typeBlock) throw new Error("CruxEvidenceErrorCode registry is unreadable");
const coreCodes = new Set(
  [...typeBlock.matchAll(/"(EVIDENCE_[A-Z_]+)"/g)].map(
    (match) => match[1],
  ),
);
const documentedCodes = new Set(
  evidenceErrorRegistry.map(({ code }) => code),
);
const healthCodes = new Set(evidenceAggregateHealthCodes);
for (const code of coreCodes) {
  if (!documentedCodes.has(code)) {
    throw new Error(`${code} is missing from the evidence docs registry`);
  }
}

async function readGoSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readGoSources(entryPath);
    if (!entry.name.endsWith(".go") || entry.name.endsWith("_test.go")) {
      return "";
    }
    return readFile(entryPath, "utf8");
  }));
  return contents.join("\n");
}

const localSources = await readGoSources(
  path.join(docsRoot, "packages/local/internal"),
);
const localCodes = new Set(
  [...localSources.matchAll(/EVIDENCE_[A-Z_]+/g)]
    .map((match) => match[0])
    .filter((code) => !code.endsWith("_RETENTION_DAYS")),
);
for (const code of localCodes) {
  if (!documentedCodes.has(code) && !healthCodes.has(code)) {
    throw new Error(`${code} is missing from the evidence docs registry`);
  }
}

const meta = JSON.parse(
  await readFile(path.join(errorsDir, "meta.json"), "utf8"),
);
const index = await readFile(path.join(errorsDir, "index.mdx"), "utf8");
for (const { code, retryable } of evidenceErrorRegistry) {
  const pagePath = path.join(errorsDir, `${code}.mdx`);
  await stat(pagePath).catch(() => {
    throw new Error(`${code} has no docs page`);
  });
  const page = await readFile(pagePath, "utf8");
  for (const required of [
    `title: ${code}`,
    "## Retryability",
    "## Fix",
    retryable ? "Retryable." : "Not retryable.",
  ]) {
    if (!page.includes(required)) {
      throw new Error(`${code} page is missing ${JSON.stringify(required)}`);
    }
  }
  if (!meta.pages.includes(code)) {
    throw new Error(`${code} is missing from errors/meta.json`);
  }
  if (!index.includes(`/docs/errors/${code}`)) {
    throw new Error(`${code} is missing from the error catalog`);
  }
}

const evidenceGuide = await readFile(
  path.join(
    docsRoot,
    "apps/docs/content/docs/guides/observability/execution-evidence.mdx",
  ),
  "utf8",
);
for (const code of evidenceAggregateHealthCodes) {
  if (!evidenceGuide.includes(code)) {
    throw new Error(`${code} aggregate health signal is undocumented`);
  }
}

console.log(
  `Checked ${evidenceErrorRegistry.length} evidence error pages and ` +
    `${evidenceAggregateHealthCodes.length} aggregate health signals.`,
);
