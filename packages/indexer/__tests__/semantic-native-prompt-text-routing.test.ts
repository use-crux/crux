import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IndexPatchFacts } from "../src/indexer/patches";
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";
import { promptTextSemanticDirectFixture } from "./prompt-text-semantic-direct-fixture";
import {
  ambiguousStarTagFixture,
  broadControlFlowFixture,
  cyclicFragmentReexportFixture,
  esmFragmentAliasFixture,
  importedFragmentsFixture,
  localRootReexportFixture,
  packageRootReexportFixture,
  pathsInterceptTagFixture,
  typeOnlyReexportFixture,
  typeOnlyEdgeFixture,
  unresolvedIdentityFixture,
  valueStarTagFixture,
  wrongPackageIdentityFixture,
} from "./prompt-text-semantic-shared-fixtures";
import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("native prompt-text semantic routing", () => {
  it("keeps the required same-file matrix on the direct projector", async () => {
    const result = await indexFixture(promptTextSemanticDirectFixture);

    expect(result.extractors).toEqual([["crux.direct-crux"]]);
    expect(result.timingNames).not.toContain("semantic.native.analyzer.shared");
    expect(promptTextRefCount(result.nativeFacts)).toBe(
      promptTextSemanticDirectFixture.expect.promptTextSourceRefs?.length,
    );
  }, 20_000);

  for (const fixture of [
    importedFragmentsFixture,
    localRootReexportFixture,
    packageRootReexportFixture,
    typeOnlyReexportFixture,
    typeOnlyEdgeFixture,
    valueStarTagFixture,
    ambiguousStarTagFixture,
    pathsInterceptTagFixture,
    wrongPackageIdentityFixture,
    esmFragmentAliasFixture,
    cyclicFragmentReexportFixture,
    broadControlFlowFixture,
    unresolvedIdentityFixture,
  ]) {
    it(`routes the complete unsupported file through shared analysis for ${fixture.name}`, async () => {
      const result = await indexFixture(fixture);

      expect(result.extractors.flat()).toContain("crux.shared-analyzer");
      expect(result.timingNames).toContain("semantic.native.analyzer.shared");
      expect(promptTextRefCount(result.nativeFacts)).toBe(
        fixture.expect.promptTextSourceRefs?.length,
      );
    }, 20_000);
  }
});

async function indexFixture(fixture: SemanticBackendParityFixture): Promise<{
  readonly nativeFacts: IndexPatchFacts;
  readonly timingNames: readonly string[];
  readonly extractors: readonly (readonly string[])[];
}> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-native-prompt-text-"),
  );
  roots.push(root);
  await writeFixture(root, fixture);
  const files = Object.keys(fixture.files)
    .filter((file) => !file.includes("/node_modules/"))
    .map((file) => join(root, file));
  const timingNames: string[] = [];
  const extractors: string[][] = [];

  const typescriptPatch = await createSemanticIndexService({
    backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
  }).indexFiles({ root, files });
  const nativePatch = await createSemanticIndexService({
    backend: createNativeSemanticBackend({ cache: "disabled" }),
  }).indexFiles({
    root,
    files,
    semanticInstrumentation: {
      onTiming: (timing) => timingNames.push(timing.name),
      onNativeCoverage: (coverage) =>
        extractors.push(
          "extractors" in coverage ? [...coverage.extractors] : [],
        ),
    },
  });

  expect(typescriptPatch.status).toBe("ok");
  expect(nativePatch.status).toBe("ok");
  expect(normalizedFacts(nativePatch.facts)).toEqual(
    normalizedFacts(typescriptPatch.facts),
  );
  return { nativeFacts: nativePatch.facts, timingNames, extractors };
}

async function writeFixture(
  root: string,
  fixture: SemanticBackendParityFixture,
): Promise<void> {
  if (fixture.workspacePackages?.includes("core")) {
    await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
    await symlink(
      join(process.cwd(), "../core"),
      join(root, "node_modules/@use-crux/core"),
      "dir",
    );
  }
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
        ...fixture.compilerOptions,
      },
      include: ["src/**/*.ts"],
    }),
  );
  for (const [path, source] of Object.entries(fixture.files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
}

function promptTextRefCount(facts: IndexPatchFacts): number {
  return (facts.sourceRefs ?? []).filter(
    (sourceRef) => sourceRef.ref.metadata?.promptText,
  ).length;
}

function normalizedFacts(facts: IndexPatchFacts): string {
  return JSON.stringify(facts, (_key, value) =>
    Array.isArray(value)
      ? [...value].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        )
      : value,
  );
}
