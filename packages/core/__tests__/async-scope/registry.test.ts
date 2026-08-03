import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { registeredAsyncScopeFacetsForTesting } from "../../src/async-scope/internal/carrier";
import "../../src/defer/internal/context";
import "../../src/defer/internal/replay-guard";
import "../../src/eval/internal/capture-context";
import "../../src/eval/internal/task-context-scope";
import "../../src/observability/context";
import "../../src/observability/delivery/host-scope";
import "../../src/runtime/api/host-context";
import "../../src/runtime/execution-context";
import "../../src/scope/kernel";
import "../../src/work/internal/attached-context";
import "../../src/work/internal/durable-host-context";

const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));
const facetDeclaration =
  /createAsyncScopeFacet(?:<[\s\S]*?>)?\(\s*["']([^"']+)["']/g;
const asyncStorageResolver =
  /\bAsyncLocalStorageConstructor\b|(?:from\s+|require\(|getBuiltinModule\?\.\()["']node:async_hooks["']/;

describe("async-scope facet registry", () => {
  it("registers every facet declared in the Core source tree", async () => {
    const sources = await readCoreSources();
    const declared = sources
      .flatMap(({ source }) =>
        [...source.matchAll(facetDeclaration)].map((match) => match[1]),
      )
      .filter((name): name is string => name !== undefined)
      .sort();

    expect(registeredAsyncScopeFacetsForTesting()).toEqual(declared);
  });

  it("keeps the canonical carrier as the only ALS resolver", async () => {
    const owners = (await readCoreSources())
      .filter(({ source }) => asyncStorageResolver.test(source))
      .map(({ path }) => path);

    expect(owners).toEqual(["async-scope/internal/carrier.ts"]);
  });
});

async function readCoreSources() {
  const entries = await readdir(sourceRoot, { recursive: true });
  const paths = entries
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => resolve(sourceRoot, entry))
    .sort();

  return Promise.all(
    paths.map(async (path) => ({
      path: relative(sourceRoot, path).replaceAll("\\", "/"),
      source: await readFile(path, "utf8"),
    })),
  );
}
