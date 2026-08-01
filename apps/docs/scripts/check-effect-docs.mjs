import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const contentRoot = path.join(docsRoot, "apps/docs/content/docs");
const guideDir = path.join(contentRoot, "guides/effects");
const guidePages = [
  "index",
  "recovery-patterns",
  "rollback-boundaries",
  "ambiguity-and-reconciliation",
];
const guidePaths = guidePages.map((page) =>
  path.join(guideDir, `${page}.mdx`),
);
const referencePath = path.join(
  contentRoot,
  "reference/crux-core/effect.mdx",
);
const errorsDir = path.join(contentRoot, "errors");

const primaryExports = [
  "effect()",
  "recover()",
  "rollbackOnError()",
  "rollback()",
  "reconcileEffect()",
  "EffectOutcomeUnknownError",
  "RollbackError",
];
const effectErrorCodes = [
  "EFFECT_DUPLICATE_ID",
  "EFFECT_RESOURCE_FAILED",
  "EFFECT_CAPTURE_FAILED",
  "EFFECT_RECOVERY_REQUIRED",
  "EFFECT_SCOPE_NOT_FOUND",
  "EFFECT_RECEIPT_NOT_FOUND",
  "EFFECT_SCOPE_TERMINAL",
  "EFFECT_OUTCOME_AMBIGUOUS",
  "EFFECT_ROLLBACK_PARTIAL",
];

for (const pagePath of [...guidePaths, referencePath]) {
  await stat(pagePath).catch(() => {
    throw new Error(`${path.relative(docsRoot, pagePath)} is missing`);
  });
}

const guide = await readFile(guidePaths[0], "utf8");
for (const required of [
  'from "@use-crux/core/effect"',
  "## When to use an effect",
  "## When not to use an effect",
  "rollback boundaries",
  "Ambiguity and reconciliation",
  "## Inspect effects in Devtools",
  "unanalyzable binding",
  "recovery.of",
  "effects ·",
  "Devtools is read-only for Effects",
]) {
  if (!guide.includes(required)) {
    throw new Error(`Effects guide is missing ${JSON.stringify(required)}`);
  }
}

const recoveryPatterns = await readFile(guidePaths[1], "utf8");
for (const required of [
  "## Choose a recovery form",
  "idempotencyKey",
  "## Prevent double recovery",
  "conflict: \"force\"",
  "version",
]) {
  if (!recoveryPatterns.includes(required)) {
    throw new Error(
      `Effects recovery patterns are missing ${JSON.stringify(required)}`,
    );
  }
}

const rollbackBoundaries = await readFile(guidePaths[2], "utf8");
for (const required of [
  "rollbackOnError",
  'recovery: "best-effort"',
  "RollbackResult",
  "not_possible",
  "boundary.ref",
  "## Effects inside tools and flow steps",
]) {
  if (!rollbackBoundaries.includes(required)) {
    throw new Error(
      `Effects rollback boundaries are missing ${JSON.stringify(required)}`,
    );
  }
}

const ambiguity = await readFile(guidePaths[3], "utf8");
for (const required of [
  "EffectOutcomeUnknownError",
  "reconcileEffect",
  'outcome: "succeeded"',
  'outcome: "failed"',
  "recovery attempt",
]) {
  if (!ambiguity.includes(required)) {
    throw new Error(
      `Effects ambiguity guide is missing ${JSON.stringify(required)}`,
    );
  }
}

for (let index = 0; index < guidePaths.length; index += 1) {
  const page = await readFile(guidePaths[index], "utf8");
  if (page.includes("—")) {
    throw new Error(`${guidePages[index]} contains an em dash`);
  }
}

const effectsMeta = JSON.parse(
  await readFile(path.join(guideDir, "meta.json"), "utf8"),
);
if (JSON.stringify(effectsMeta.pages) !== JSON.stringify(guidePages)) {
  throw new Error("Effects guide pages are missing or out of order");
}

const reference = await readFile(referencePath, "utf8");
for (const exportedName of primaryExports) {
  if (!reference.includes(`## \`${exportedName}\``)) {
    throw new Error(`Effects reference is missing ${exportedName}`);
  }
}
for (const optionsType of [
  "CapturedRecoverableEffectOptions",
  "RecoverableEffectOptions",
  "EffectOptions",
]) {
  if (!reference.includes(optionsType)) {
    throw new Error(`Effects reference is missing ${optionsType}`);
  }
}
for (const page of guidePages.slice(1)) {
  if (!reference.includes(`/docs/guides/effects/${page}`)) {
    throw new Error(`Effects reference is missing the ${page} guide link`);
  }
}

const guidesMeta = JSON.parse(
  await readFile(path.join(contentRoot, "guides/meta.json"), "utf8"),
);
if (!guidesMeta.pages.includes("effects")) {
  throw new Error("Effects is missing from guides/meta.json");
}
const guidesIndex = await readFile(
  path.join(contentRoot, "guides/index.mdx"),
  "utf8",
);
if (!guidesIndex.includes('href="/docs/guides/effects"')) {
  throw new Error("Effects is missing from the guides index");
}
const referenceMeta = JSON.parse(
  await readFile(
    path.join(contentRoot, "reference/crux-core/meta.json"),
    "utf8",
  ),
);
if (!referenceMeta.pages.includes("effect")) {
  throw new Error("Effects is missing from crux-core/meta.json");
}

const errorsMeta = JSON.parse(
  await readFile(path.join(errorsDir, "meta.json"), "utf8"),
);
const errorsIndex = await readFile(
  path.join(errorsDir, "index.mdx"),
  "utf8",
);
for (const code of effectErrorCodes) {
  const pagePath = path.join(errorsDir, `${code}.mdx`);
  await stat(pagePath).catch(() => {
    throw new Error(`${code} has no docs page`);
  });
  const page = await readFile(pagePath, "utf8");
  for (const required of [
    `title: ${code}`,
    "## What failed",
    "## Fix",
  ]) {
    if (!page.includes(required)) {
      throw new Error(`${code} page is missing ${JSON.stringify(required)}`);
    }
  }
  if (!errorsMeta.pages.includes(code)) {
    throw new Error(`${code} is missing from errors/meta.json`);
  }
  if (!errorsIndex.includes(`/docs/errors/${code}`)) {
    throw new Error(`${code} is missing from the error catalog`);
  }
  if (!page.includes("/docs/guides/effects")) {
    throw new Error(`${code} is missing its Effects guide link`);
  }
}

const recoveryRequired = await readFile(
  path.join(errorsDir, "EFFECT_RECOVERY_REQUIRED.mdx"),
  "utf8",
);
for (const action of [
  "Define a recovery handler",
  "Move the effect outside",
  '`{ recovery: "best-effort" }`',
]) {
  if (!recoveryRequired.includes(action)) {
    throw new Error(
      `EFFECT_RECOVERY_REQUIRED is missing ${JSON.stringify(action)}`,
    );
  }
}

console.log(
  `Checked ${guidePages.length} Effects guides, ` +
    `${primaryExports.length} public exports, and ` +
    `${effectErrorCodes.length} error pages.`,
);
