import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  callPattern,
  facts,
  type IndexerExtension,
} from "../indexer/extensions/public-contract";
import { loadIndexerExtensionReferences } from "../indexer/extensions/loading";
import { staticIndexExtractorCoverage } from "../indexer/static-index/extension-host/host-plan";
import { createIndexerExtensionRuntime } from "../indexer/extensions/runtime";
import { createStaticRecordEvidenceReader } from "../indexer/static-index/extension-host/evidence";
import { createStaticExtensionRegistry } from "../indexer/static-index/compatibility/syntax-record-bridge";
import { collectProjectedSemanticEvidence } from "../indexer/semantic/evidence";
import { createNativeSemanticBackend } from "../indexer/semantic/backends/tsgo";
import { nativeDirectPrimitiveManifest } from "../indexer/semantic/backends/tsgo/direct-projectors";
import { createSemanticIndexService } from "../indexer/semantic/service";
import { createTypeScriptSemanticBackend } from "../indexer/semantic/backends/typescript";
import {
  collectStaticIndexVocabularyObservations,
  staticIndexVocabularyGuards,
} from "./static-index-naming-guards";
import { architectureBaselineRequiredTokens } from "./architecture-target-inventory";
import {
  collectProjectIndexGoVocabularyObservations,
  projectIndexGoVocabularyGuards,
} from "./project-index-go-vocabulary-guards";

const indexerDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "indexer",
);
const indexerPackageDir = join(indexerDir, "..");
const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

const committedArchitectureBaseline = join(
  indexerPackageDir,
  "docs",
  "static-index-runtime-architecture-baseline.md",
);

describe("indexer architecture boundaries", () => {
  it("keeps the committed architecture baseline aligned with target ownership folders", () => {
    const source = readFileSync(committedArchitectureBaseline, "utf8");

    for (const token of architectureBaselineRequiredTokens) {
      expect(source, token).toContain(token);
    }
  });

  it("groups extension internals behind responsibility barrels", () => {
    const extension: IndexerExtension = {
      name: "@use-crux/test-extension",
      version: "0.0.0",
      crux: { indexer: "^0.1.0" },
      extractors: [
        {
          name: "test.extractor",
          patterns: [callPattern({ name: "test" })],
          extract: () => facts({}),
        },
      ],
    };

    expect(createIndexerExtensionRuntime({ extensions: [extension] })).toEqual(
      expect.objectContaining({ extractStatic: expect.any(Function) }),
    );
    expect(createStaticExtensionRegistry([extension]).extractors).toHaveLength(
      1,
    );
    expect(createStaticRecordEvidenceReader).toBeTypeOf("function");
    expect(loadIndexerExtensionReferences).toBeTypeOf("function");
    expect(
      staticIndexExtractorCoverage({
        extension: { name: "@use-crux/test-extension", version: "0.0.0" },
        name: "x",
      }),
    ).toMatchObject({
      covered: false,
    });

    for (const file of [
      "authoring-types.ts",
      "facts.ts",
      "loading.ts",
      "static-index-coverage.ts",
      "runtime.ts",
      "static-adapter.ts",
      "static-evidence.ts",
      "static-record-runtime.ts",
    ]) {
      expect(existsSync(join(indexerDir, "extensions", file)), file).toBe(
        false,
      );
    }

    expect(redundantContextualNames(join(indexerDir, "extensions"))).toEqual(
      [],
    );
  });

  it("groups semantic internals behind evidence, TypeScript, and tsgo backend barrels", () => {
    expect(collectProjectedSemanticEvidence).toBeTypeOf("function");
    expect(
      createSemanticIndexService({
        backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
      }),
    ).toEqual(
      expect.objectContaining({
        indexFiles: expect.any(Function),
        indexProject: expect.any(Function),
      }),
    );
    expect(createNativeSemanticBackend).toBeTypeOf("function");
    expect(
      nativeDirectPrimitiveManifest.some((spec) => spec.callName === "prompt"),
    ).toBe(true);

    for (const file of [
      "evidence.ts",
      "facts.ts",
      "tsgo-compiler-session.ts",
      "typescript-compiler-view.ts",
      "typescript-fact-input.ts",
    ]) {
      expect(existsSync(join(indexerDir, "semantic", file)), file).toBe(false);
    }
    for (const file of [
      "semantic/backends/typescript/index.ts",
      "semantic/backends/tsgo/index.ts",
      "semantic/backends/tsgo/direct-projectors/index.ts",
      "semantic/backends/tsgo/direct-projectors/manifest.ts",
    ]) {
      expect(existsSync(join(indexerDir, file)), file).toBe(true);
    }

    for (const file of [
      "semantic/native",
      "semantic/typescript",
      "semantic/backends/tsgo/direct-projectors/tsgo-native-direct-manifest.ts",
    ]) {
      expect(existsSync(join(indexerDir, file)), file).toBe(false);
    }
    expect(redundantContextualNames(join(indexerDir, "semantic"))).toEqual([]);
  });

  it("homes TypeScript Static Index internals under static-index responsibility folders", () => {
    for (const file of [
      "static-index/index.ts",
      "static-index/config/index.ts",
      "static-index/config/inspect.ts",
      "static-index/plan/index.ts",
      "static-index/plan/files.ts",
      "static-index/protocol/index.ts",
      "static-index/protocol/request.ts",
      "static-index/protocol/response.ts",
      "static-index/protocol/identity.ts",
      "static-index/protocol/telemetry.ts",
      "static-index/syntax/index.ts",
      "static-index/syntax/frontends/oxc.ts",
      "static-index/syntax/record/index.ts",
      "static-index/extension-host/index.ts",
      "static-index/extension-host/host-plan/index.ts",
      "static-index/extension-host/evidence/index.ts",
      "static-index/compatibility/syntax-record-bridge/index.ts",
    ]) {
      expect(existsSync(join(indexerDir, file)), file).toBe(true);
    }

    for (const file of [
      "native-static-config.ts",
      "native-static-extension-host.ts",
      "native-static-inspect.ts",
      "static-plan.ts",
      "static-plan-support-files.ts",
      "worker-protocol/native-static.ts",
      "worker-protocol/native-static-parse.ts",
      "worker-protocol/native-static-parser-interests.ts",
      "contracts/native-static/schema.ts",
      "contracts/native-static/fixtures.ts",
      "static-index/extension-host/coverage/index.ts",
      "static/syntax-record/index.ts",
    ]) {
      expect(existsSync(join(indexerDir, file)), file).toBe(false);
    }
  });

  it("does not retain the legacy TypeScript AST first-party static parser", () => {
    for (const file of [
      "static/file.ts",
      "static/runtime-prepare.ts",
      "static/extraction/parser.ts",
      "static/extraction/match.ts",
      "static/extraction/tree-paths.ts",
    ]) {
      expect(existsSync(join(indexerDir, file)), file).toBe(false);
    }
  });

  it("does not construct the TypeScript syntax frontend implicitly outside testing", () => {
    for (const file of [
      "static/extraction/engine.ts",
      "static-index/syntax/record/file.ts",
    ]) {
      const source = readFileSync(join(indexerDir, file), "utf8");

      expect(source, file).not.toContain(
        "createTypeScriptStaticSyntaxFrontend",
      );
    }
  });

  it("does not retain compatibility paths for moved host and contract surfaces", () => {
    for (const path of [
      "internal-host.ts",
      "worker-host.ts",
      "worker-protocol.ts",
      "indexer/contracts",
      "contracts/native-static",
      "contracts/native-static/schema.ts",
      "contracts/native-static/fixtures.ts",
    ]) {
      expect(existsSync(join(indexerPackageDir, path)), path).toBe(false);
    }
  });

  it("records the deprecated Static Index vocabulary with its final replacements", () => {
    expect(
      staticIndexVocabularyGuards.map(
        ({ term, replacements, targetedPhases }) => ({
          term,
          replacements,
          targetedPhases,
        }),
      ),
    ).toEqual([
      {
        term: "native-static",
        replacements: ["static-index"],
        targetedPhases: [2, 5, 6, 7, 8],
      },
      {
        term: "nativeStatic",
        replacements: ["staticIndex"],
        targetedPhases: [7, 8],
      },
      {
        term: "NativeStatic",
        replacements: ["StaticIndex"],
        targetedPhases: [7, 8],
      },
      {
        term: "native static",
        replacements: ["Static Index"],
        targetedPhases: [5, 6, 7, 8],
      },
      {
        term: "nativeAst",
        replacements: ["staticIndex", "staticSyntax", "oxcSyntax"],
        targetedPhases: [2, 5, 7, 8],
      },
      {
        term: "projectindexer",
        replacements: ["projectindex"],
        targetedPhases: [4, 5],
      },
      {
        term: "native_static",
        replacements: ["static_index"],
        targetedPhases: [6, 7, 8],
      },
      {
        term: "NATIVE_STATIC",
        replacements: ["STATIC_INDEX"],
        targetedPhases: [7, 8],
      },
      {
        term: "CRUX_INDEXER_WORKER",
        replacements: ["CRUX_STATIC_INDEX_WORKER"],
        targetedPhases: [8],
      },
    ]);
  });

  it("keeps stale Static Index implementation vocabulary out of source roots", () => {
    const observations = collectStaticIndexVocabularyObservations(repoRoot);

    expect(observations.map(({ guard }) => guard.term)).toEqual([
      "native-static",
      "nativeStatic",
      "NativeStatic",
      "native static",
      "nativeAst",
      "projectindexer",
      "native_static",
      "NATIVE_STATIC",
      "CRUX_INDEXER_WORKER",
    ]);
    expect(observationFor(observations, "native-static").matches).toEqual([]);
    expect(observationFor(observations, "nativeStatic").matches).toEqual([]);
    expect(observationFor(observations, "NativeStatic").matches).toEqual([]);
    expect(observationFor(observations, "native static").matches).toEqual([]);
    expect(observationFor(observations, "nativeAst").matches).toEqual([]);
    expect(observationFor(observations, "projectindexer").matches).toEqual([]);
    expect(observationFor(observations, "native_static").matches).toEqual([]);
    expect(observationFor(observations, "NATIVE_STATIC").matches).toEqual([]);
    expect(observationFor(observations, "CRUX_INDEXER_WORKER").matches).toEqual(
      [],
    );
  });

  it("keeps stale Go Project Index vocabulary out of new source files", () => {
    const observations = collectProjectIndexGoVocabularyObservations(repoRoot);

    expect(
      projectIndexGoVocabularyGuards.map(
        ({ term, replacement, targetedPhase }) => ({
          term,
          replacement,
          targetedPhase,
        }),
      ),
    ).toEqual([
      { term: "indexwire", replacement: "requestwire", targetedPhase: 4 },
    ]);
    expect(observations.map(({ guard }) => guard.term)).toEqual(["indexwire"]);
    expect(observations[0]?.matches).toEqual([]);
  });
});

function observationFor(
  observations: ReturnType<typeof collectStaticIndexVocabularyObservations>,
  term: (typeof staticIndexVocabularyGuards)[number]["term"],
) {
  const observation = observations.find(
    (candidate) => candidate.guard.term === term,
  );
  expect(observation, term).toBeDefined();
  return observation!;
}

function redundantContextualNames(root: string): readonly string[] {
  return relativeFiles(root).filter((file) =>
    [
      /^static-record-adapter\/static-record-/,
      /^static-record-adapter\/static-(adapter|normalizer)\.ts$/,
      /^static-record-adapter\/internal-/,
      /^static-evidence\/static-(evidence|extension|interest)/,
      /^native-coverage\/(static-index|extension-host)/,
      /^runtime\/runtime/,
      /^loading\/loading/,
      /^evidence\/evidence\.ts$/,
      /tsgo-native-direct/,
    ].some((pattern) => pattern.test(file)),
  );
}

function relativeFiles(root: string): readonly string[] {
  const files: string[] = [];
  collectRelativeFiles(root, "", files);
  return files.sort();
}

function collectRelativeFiles(
  root: string,
  relativeRoot: string,
  files: string[],
): void {
  for (const entry of readdirSync(join(root, relativeRoot))) {
    const relativePath = relativeRoot ? `${relativeRoot}/${entry}` : entry;
    const absolutePath = join(root, relativePath);
    if (statSync(absolutePath).isDirectory()) {
      collectRelativeFiles(root, relativePath, files);
    } else {
      files.push(relativePath);
    }
  }
}
