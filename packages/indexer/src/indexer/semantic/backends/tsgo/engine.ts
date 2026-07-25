import { semanticEvidenceBatchesFromFacts } from "../../evidence/projection";
import { semanticIndexEvidenceBatchesForSourceFiles } from "../../evidence/facts";
import { measureSemanticTiming } from "../../instrumentation";
import {
  createTsgoSemanticCompilerHost,
  type TsgoSemanticCompilerHost,
} from "./compiler-session";
import { tsgoNativeSemanticRuntimeVersion } from "./runtime-identity";
import type {
  NativeSemanticEngineAnalyzeInput,
  NativeSemanticAnalyzeResult,
  NativeSemanticEngine,
  NativeSemanticEngineCapabilities,
  NativeSemanticEngineIdentity,
} from "./types";
import type {
  SemanticBackendIdentity,
  SemanticProjectSessionIdentity,
} from "../../service/types";

const directCruxExtractor = "crux.direct-crux";
const sharedAnalyzerExtractor = "crux.shared-analyzer";

export const tsgoNativeSemanticEngineIdentity = {
  name: "tsgo",
  version: tsgoNativeSemanticRuntimeVersion,
} as const satisfies NativeSemanticEngineIdentity<"tsgo">;

const tsgoNativeSemanticEngineCapabilities = {
  nativeEvidence: "complete",
  syntaxTraversal: "native-ast",
} as const satisfies NativeSemanticEngineCapabilities;

export interface TsgoNativeSemanticEngineInput {
  /** Absolute Project Index root. */
  readonly root: string;
  /** Parent native backend identity used for cache/session ownership. */
  readonly backendIdentity: SemanticBackendIdentity<"native">;
  /** Semantic project identity used for tsconfig selection. */
  readonly session: SemanticProjectSessionIdentity;
  /** Optional TypeScript-Go executable path for native-preview API mode. */
  readonly tsserverPath?: string;
}

/** Creates the TypeScript-Go implementation of the native semantic engine. */
export function createTsgoNativeSemanticEngine(
  input: TsgoNativeSemanticEngineInput,
): NativeSemanticEngine {
  const host = createTsgoSemanticCompilerHost({
    root: input.root,
    session: input.session,
    identity: input.backendIdentity,
    tsserverPath: input.tsserverPath,
  });

  return {
    identity: tsgoNativeSemanticEngineIdentity,
    backendIdentity: input.backendIdentity,
    capabilities: tsgoNativeSemanticEngineCapabilities,
    analyze(analyzeInput) {
      return analyzeWithTsgoNativeEngine(host, analyzeInput);
    },
    close() {
      host.close();
    },
  };
}

function analyzeWithTsgoNativeEngine(
  host: TsgoSemanticCompilerHost,
  analyzeInput: NativeSemanticEngineAnalyzeInput,
): NativeSemanticAnalyzeResult {
  const direct = measureSemanticTiming(
    analyzeInput.instrumentation,
    "semantic.native.extractor.direct_crux",
    () =>
      host.analyzeNativeDirect({
        files: analyzeInput.files,
        dependencyClosure: analyzeInput.dependencyClosure,
        sourceProfile: analyzeInput.sourceProfile,
        validationDependencies: analyzeInput.validationDependencies,
      }),
  );
  if (direct) {
    const extractors =
      direct.unsupportedFiles.length > 0
        ? [directCruxExtractor, sharedAnalyzerExtractor]
        : [directCruxExtractor];
    return {
      coverage: {
        kind: "complete-native",
        engine: tsgoNativeSemanticEngineIdentity,
        syntaxTraversal: tsgoNativeSemanticEngineCapabilities.syntaxTraversal,
        extractors,
      },
      evidence:
        direct.unsupportedFiles.length > 0
          ? mixedNativeEvidence(
              host,
              analyzeInput,
              direct.facts,
              direct.unsupportedFiles,
            )
          : semanticEvidenceBatchesFromFacts(direct.facts),
    };
  }

  return {
    coverage: {
      kind: "complete-native",
      engine: tsgoNativeSemanticEngineIdentity,
      syntaxTraversal: tsgoNativeSemanticEngineCapabilities.syntaxTraversal,
      extractors: [sharedAnalyzerExtractor],
    },
    evidence: sharedAnalyzerEvidence(host, analyzeInput),
  };
}

function* mixedNativeEvidence(
  host: TsgoSemanticCompilerHost,
  analyzeInput: NativeSemanticEngineAnalyzeInput,
  directFacts: Parameters<typeof semanticEvidenceBatchesFromFacts>[0],
  sharedFiles: readonly string[],
) {
  yield* semanticEvidenceBatchesFromFacts(directFacts);
  yield* sharedAnalyzerEvidence(host, { ...analyzeInput, files: sharedFiles });
}

function* sharedAnalyzerEvidence(
  host: TsgoSemanticCompilerHost,
  analyzeInput: NativeSemanticEngineAnalyzeInput,
) {
  const session = measureSemanticTiming(
    analyzeInput.instrumentation,
    "semantic.native.analyzer.shared",
    () =>
      host.analyze({
        files: analyzeInput.files,
        dependencyClosure: analyzeInput.dependencyClosure,
        sourceProfile: analyzeInput.sourceProfile,
        validationDependencies: analyzeInput.validationDependencies,
      }),
  );
  try {
    yield* semanticIndexEvidenceBatchesForSourceFiles(
      {
        root: analyzeInput.root,
        sourceFiles: session.sourceFiles,
        view: session.view,
      },
      { instrumentation: analyzeInput.instrumentation },
    );
  } finally {
    session.close();
  }
}
