import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { IndexPatchFacts } from "../src/indexer/patches";
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";
import {
  semanticBackendParityFixtures,
  type SemanticBackendParityFixture,
} from "./semantic-backend-parity-fixtures";
import { normalizedPromptTextSourceRefs } from "./prompt-text-semantic-parity-normalize";

const roots: string[] = [];

async function fixtureRoot(externalRoot = false): Promise<string> {
  const base = externalRoot ? tmpdir() : join(process.cwd(), ".tmp");
  if (!externalRoot) await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "semantic-backend-parity-"));
  roots.push(root);
  return root;
}

afterEach(cleanupRoots, 30_000);
afterAll(cleanupRoots, 30_000);

describe("semantic backend parity", () => {
  for (const fixture of semanticBackendParityFixtures) {
    it(`matches TypeScript semantic facts without cache for ${fixture.name}`, async () => {
      const { root, files } = await writeFixture(fixture);
      const typescriptPatch = await createSemanticIndexService({
        backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
      }).indexFiles({ root, files });
      const nativePatch = await createSemanticIndexService({
        backend: createNativeSemanticBackend({ cache: "disabled" }),
      }).indexFiles({ root, files });

      expect(typescriptPatch.status).toBe("ok");
      expect(nativePatch.status).toBe("ok");
      expect(typescriptPatch.semanticBackend).toBe("typescript");
      expect(nativePatch.semanticBackend).toBe("native");
      assertFixtureCoverage(fixture, root, typescriptPatch.facts);
      expect(normalizedFacts(nativePatch.facts)).toEqual(
        normalizedFacts(typescriptPatch.facts),
      );
      if (
        fixture.name === "authored-media-shared-analyzer" ||
        fixture.name === "authored-mcp-shared-analyzer" ||
        fixture.name === "authored-embedding-shared-analyzer"
      ) {
        expect(JSON.stringify(nativePatch.facts)).not.toMatch(
          /private-file-id|private-ref|SECRET_LANGUAGE|SECRET_MCP_PARITY_TOKEN|PHASE7_PRIVATE_SENTINEL|mediaBytes/,
        );
      }
    }, 60_000);

    it(`matches TypeScript semantic facts through public cached indexing for ${fixture.name}`, async () => {
      const { root } = await writeFixture(fixture);
      const service = createSemanticIndexService();
      const typescriptPatch = await service.indexProject({
        root,
        semanticBackend: "typescript",
      });
      const nativePatch = await service.indexProject({
        root,
        semanticBackend: { name: "native" },
      });
      const cachedTypescriptPatch = await service.indexProject({
        root,
        semanticBackend: "typescript",
      });
      const cachedNativePatch = await service.indexProject({
        root,
        semanticBackend: { name: "native" },
      });

      expect(typescriptPatch.status).toBe("ok");
      expect(nativePatch.status).toBe("ok");
      expect(typescriptPatch.semanticBackend).toBe("typescript");
      expect(nativePatch.semanticBackend).toBe("native");
      expect(cachedTypescriptPatch.status).toBe("ok");
      expect(cachedNativePatch.status).toBe("ok");
      assertFixtureCoverage(fixture, root, typescriptPatch.facts);
      expect(normalizedFacts(nativePatch.facts)).toEqual(
        normalizedFacts(typescriptPatch.facts),
      );
      expect(normalizedFacts(cachedTypescriptPatch.facts)).toEqual(
        normalizedFacts(typescriptPatch.facts),
      );
      expect(normalizedFacts(cachedNativePatch.facts)).toEqual(
        normalizedFacts(typescriptPatch.facts),
      );
    }, 60_000);
  }
});

async function writeFixture(
  fixture: SemanticBackendParityFixture,
): Promise<{ readonly root: string; readonly files: readonly string[] }> {
  const root = await fixtureRoot(fixture.externalRoot);
  if (fixture.workspacePackages?.length) {
    const scope = join(root, "node_modules/@use-crux");
    await mkdir(scope, { recursive: true });
    await Promise.all(
      fixture.workspacePackages.map((name) =>
        symlink(join(process.cwd(), `../${name}`), join(scope, name), "dir"),
      ),
    );
    if (fixture.workspacePackages.includes("ai")) {
      await symlink(
        join(process.cwd(), "../ai/node_modules/ai"),
        join(root, "node_modules/ai"),
        "dir",
      );
    }
    if (fixture.workspacePackages.includes("openai")) {
      await symlink(
        join(process.cwd(), "../openai/node_modules/openai"),
        join(root, "node_modules/openai"),
        "dir",
      );
    }
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

  const files = Object.keys(fixture.files)
    .filter((path) => !path.includes("/node_modules/"))
    .map((path) => join(root, path));
  for (const [path, source] of Object.entries(fixture.files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  return { root, files };
}

function assertFixtureCoverage(
  fixture: SemanticBackendParityFixture,
  root: string,
  facts: IndexPatchFacts,
): void {
  const coverage = semanticFactCoverage(facts);
  expect(coverage.definitionIds).toEqual(
    expect.arrayContaining([...(fixture.expect.definitionIds ?? [])]),
  );
  expect(coverage.relationTypes).toEqual(
    expect.arrayContaining([...(fixture.expect.relationTypes ?? [])]),
  );
  expect(coverage.sourceRefRoles).toEqual(
    expect.arrayContaining([...(fixture.expect.sourceRefRoles ?? [])]),
  );
  expect(coverage.lintRuleIds).toEqual(
    expect.arrayContaining([...(fixture.expect.lintRuleIds ?? [])]),
  );
  for (const [definitionId, expectedFacts] of Object.entries(
    fixture.expect.definitionFacts ?? {},
  )) {
    const definition = (facts.definitions ?? []).find(
      (candidate) => candidate.id === definitionId,
    );
    expect(definition?.metadata?.facts).toMatchObject(expectedFacts);
  }
  for (const [definitionId, absentKeys] of Object.entries(
    fixture.expect.definitionFactKeysAbsent ?? {},
  )) {
    const definition = (facts.definitions ?? []).find(
      (candidate) => candidate.id === definitionId,
    );
    for (const key of absentKeys)
      expect(definition?.metadata?.facts ?? {}).not.toHaveProperty(key);
  }
  for (const [definitionId, profile] of Object.entries(
    fixture.expect.definitionProfiles ?? {},
  )) {
    const definition = (facts.definitions ?? []).find(
      (candidate) => candidate.id === definitionId,
    );
    expect(definition?.metadata?.profile).toEqual(profile);
  }
  if (fixture.expect.promptTextSourceRefs) {
    const promptTextSourceRefs = normalizedPromptTextSourceRefs(facts, root);
    expect(promptTextSourceRefs).toEqual(fixture.expect.promptTextSourceRefs);
  }
}

function semanticFactCoverage(facts: IndexPatchFacts): {
  readonly definitionIds: readonly string[];
  readonly relationTypes: readonly string[];
  readonly sourceRefRoles: readonly string[];
  readonly lintRuleIds: readonly string[];
} {
  return {
    definitionIds: [
      ...new Set((facts.definitions ?? []).map((definition) => definition.id)),
    ].sort(),
    relationTypes: [
      ...new Set((facts.relations ?? []).map((relation) => relation.type)),
    ].sort(),
    sourceRefRoles: [
      ...new Set((facts.sourceRefs ?? []).map((ref) => ref.ref.role)),
    ].sort(),
    lintRuleIds: [
      ...new Set((facts.lintFindings ?? []).map((finding) => finding.ruleId)),
    ].sort(),
  };
}

function normalizedFacts(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sortJsonRows(facts.definitions),
    sourceRefs: sortJsonRows(facts.sourceRefs),
    relations: sortJsonRows(facts.relations),
    diagnostics: sortJsonRows(facts.diagnostics),
    lintFindings: sortJsonRows(facts.lintFindings),
    sources: sortJsonRows(facts.sources),
    sourceGraph: facts.sourceGraph,
  };
}

function sortJsonRows<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows
    ? [...rows].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
    : undefined;
}

async function cleanupRoots(): Promise<void> {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
  roots.splice(0);
}
