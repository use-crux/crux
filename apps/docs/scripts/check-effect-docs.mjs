import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const contentRoot = path.join(docsRoot, "apps/docs/content/docs");
const guidePath = path.join(contentRoot, "guides/effects.mdx");
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

for (const pagePath of [guidePath, referencePath]) {
  await stat(pagePath).catch(() => {
    throw new Error(`${path.relative(docsRoot, pagePath)} is missing`);
  });
}

const guide = await readFile(guidePath, "utf8");
for (const required of [
  'from "@use-crux/core/effect"',
  "rollbackOnError",
  'recovery: "best-effort"',
  "reconcileEffect",
  "## Inspect Effects in Devtools",
  "unanalyzable binding",
  "recovery.of",
  "effects ·",
  "Devtools is read-only for Effects",
]) {
  if (!guide.includes(required)) {
    throw new Error(`Effects guide is missing ${JSON.stringify(required)}`);
  }
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

const guidesMeta = JSON.parse(
  await readFile(path.join(contentRoot, "guides/meta.json"), "utf8"),
);
if (!guidesMeta.pages.includes("effects")) {
  throw new Error("Effects is missing from guides/meta.json");
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
  `Checked the Effects guide, ${primaryExports.length} public exports, and ` +
    `${effectErrorCodes.length} error pages.`,
);
