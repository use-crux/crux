import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { STATIC_PARSE_CACHE_EPOCH } from "../src/indexer/cache-identity";
import { staticParseCacheManifestStatus } from "../src/indexer/static/extraction/cache";
import { createStaticExtraction } from "../src/indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("misses and rebuilds a valid static-parse-v76 tagged-template cache", async () => {
  const root = await mkdtemp(
    join(workspaceRoot, ".tmp-tagged-template-cache-"),
  );
  roots.push(root);
  const file = join(root, "src/prompt.ts");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    [
      "import { md } from '@use-crux/core'",
      "export const answer = prompt({ prompt: md`Answer ${input.question}` })",
    ].join("\n"),
  );

  const extraction = createStaticExtraction({
    root,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  });
  await extraction.extractFile(file);

  const cacheRoot = join(root, ".crux", "cache", "index");
  const currentEpoch: string = STATIC_PARSE_CACHE_EPOCH;
  if (currentEpoch !== "static-parse-v76") {
    await rename(
      join(cacheRoot, currentEpoch),
      join(cacheRoot, "static-parse-v76"),
    );
  }

  await expect(
    staticParseCacheManifestStatus({
      root,
      files: [file],
      compilerInputs: extraction.identity.cacheInputs,
    }),
  ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });

  await extraction.extractFile(file);
  await expect(
    staticParseCacheManifestStatus({
      root,
      files: [file],
      compilerInputs: extraction.identity.cacheInputs,
    }),
  ).resolves.toMatchObject({ cacheHits: [file], cacheMisses: [] });
});
