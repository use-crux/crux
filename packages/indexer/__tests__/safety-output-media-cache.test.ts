import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { STATIC_PARSE_CACHE_EPOCH } from "../src/indexer/cache-identity";
import { staticParseCacheManifestStatus } from "../src/indexer/static/extraction/cache";
import { createStaticExtraction } from "../src/indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../src/indexer/static-index/syntax";

it("does not load the cache namespace from before output media safety indexing", async () => {
  const root = await mkdtemp(join(tmpdir(), "crux-output-media-cache-"));
  const file = join(root, "safety.ts");
  try {
    await writeFile(
      file,
      "export const generated = guardrail({ on: boundary.output.media(), run: check })",
    );
    const extraction = createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    });
    await extraction.extractFile(file);
    const cacheRoot = join(root, ".crux", "cache", "index");
    await rename(
      join(cacheRoot, STATIC_PARSE_CACHE_EPOCH),
      join(cacheRoot, "static-parse-v70"),
    );

    await expect(
      staticParseCacheManifestStatus({
        root,
        files: [file],
        compilerInputs: extraction.identity.cacheInputs,
      }),
    ).resolves.toMatchObject({ cacheHits: [], cacheMisses: [file] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
