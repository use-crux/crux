import { build } from "esbuild";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = new URL("..", import.meta.url).pathname;
const outputRoot = join(
  packageRoot,
  "src/project-index/primitive-evidence-coverage/generated",
);
const temporaryRoot = await mkdtemp(
  join(tmpdir(), "crux-evidence-coverage-generator-"),
);

try {
  const bundle = join(temporaryRoot, "coverage.mjs");
  await build({
    entryPoints: [
      join(
        packageRoot,
        "src/project-index/primitive-evidence-coverage/generator-entry.ts",
      ),
    ],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
  });
  const { generatedPrimitiveEvidenceCoverage } = await import(
    pathToFileURL(bundle).href
  );
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    writeGenerated(
      join(outputRoot, "primitive-evidence-coverage.json"),
      generatedPrimitiveEvidenceCoverage.json,
    ),
    writeGenerated(
      join(outputRoot, "primitive-evidence-coverage.md"),
      generatedPrimitiveEvidenceCoverage.markdown,
    ),
  ]);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function writeGenerated(file, content) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
