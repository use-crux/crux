import type {
  ProjectIndexSnapshot,
  ProjectDefinition,
  ProjectRelation,
  IndexRuleDescriptor,
} from "@use-crux/core/project-index";
import { applyIndexLintConfig } from "../lints/config";
import { indexLintFindings } from "../lints/findings";
import { applyIndexLintSuppressions } from "../lints/suppressions";
import { builtInIndexRuleDescriptors } from "../lints/rules";
import {
  astIndexPatchFromCompilerResult,
  type ProjectIndexCompilerResult,
} from "../compiler";
import { createIndexGraphBuilder, graphSources } from "../graph/builder";
import type { IndexPatch } from "../patches";
import { createStaticExtraction } from "../static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../static-index/syntax";
import { compareCodepoint } from "../sort";
import { indexInvalidationFromDecision } from "./invalidation";
import type {
  DependencyClosureReindexDecision,
  SourceFileReindexDecision,
} from "./types";
import type {
  SemanticSourceProfile,
  SemanticSourceProfileFile,
} from "../semantic/source-profile";

type StaticExecutableDecision =
  | SourceFileReindexDecision
  | DependencyClosureReindexDecision;

interface StaticPartialPatchInput {
  readonly decision: StaticExecutableDecision;
  readonly previousIndex: ProjectIndexSnapshot;
  readonly projectName?: string;
  readonly configPath?: string;
  readonly startedAt: string;
}

/**
 * Executes a planner-approved AST/source-only partial index and returns one exact-invalidation patch.
 */
export async function indexProjectAstPartial(
  input: StaticPartialPatchInput,
): Promise<{
  readonly patch: IndexPatch;
  readonly parsedFiles: readonly string[];
}> {
  const definitions: ProjectDefinition[] = [];
  const relations: ProjectRelation[] = [];
  const dependenciesByFile = new Map<string, string[]>();
  const graphBuilder = createIndexGraphBuilder();
  const parsedFiles: string[] = [];
  const semanticProfiles: SemanticSourceProfileFile[] = [];
  // Changed files are static-cache misses by construction. Full AST refreshes
  // still warm the durable cache; the watch hot path skips cache IO so Tier-A
  // syntax feedback is bounded by parsing/projection, not filesystem writes.
  const extraction = createStaticExtraction({
    root: input.decision.root,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
    cache: "none",
  });

  for (const file of input.decision.affectedFiles) {
    if (input.decision.deletedFiles.includes(file)) continue;
    const parsed = await extraction.extractFile(file);
    const previousSource = previousSourceForFile(input.previousIndex, file);
    parsedFiles.push(file);
    if (parsed.semanticProfile) semanticProfiles.push(parsed.semanticProfile);
    dependenciesByFile.set(file, [...parsed.dependencies]);
    definitions.push(...parsed.definitions);
    relations.push(...parsed.relations);
    graphBuilder.addSource({
      source: {
        file,
        status: "indexed",
        ...(previousSource?.shardId ? { shardId: previousSource.shardId } : {}),
        ...(parsed.semanticProfile?.sourceHash
          ? { sourceHash: parsed.semanticProfile.sourceHash }
          : {}),
        ...(parsed.interfaceHash
          ? { interfaceHash: parsed.interfaceHash }
          : {}),
        definitionIds: parsed.definitions.map((definition) => definition.id),
        dependencies: [...parsed.dependencies],
        dependents: [...(previousSource?.dependents ?? [])],
        diagnostics: [],
      },
    });
    parsed.definitions.forEach((definition) =>
      graphBuilder.addDefinition({ definition }),
    );
    parsed.relations.forEach((relation) =>
      graphBuilder.addRelation({ relation }),
    );
    parsed.dependencies.forEach((dependency) =>
      graphBuilder.addDependency(file, dependency),
    );
  }
  const ruleResult = extraction.rules.check({ definitions, relations });
  const runtime = runtimeLintContext(input.previousIndex);
  const lintRuleOutputs = [
    ...indexLintFindings({ definitions, relations, runtime }),
    ...ruleResult.outputs,
  ];
  const ruleDescriptors = mergeRuleDescriptors([
    ...input.previousIndex.ruleDescriptors,
    ...builtInIndexRuleDescriptors(),
    ...extraction.rules.descriptors,
  ]);
  const lintDiagnostics = [...ruleResult.diagnostics];
  const lintFindings = applyIndexLintConfig({
    config: input.previousIndex.lint,
    configFile: input.previousIndex.project.configFile,
    diagnostics: lintDiagnostics,
    ruleDescriptors,
    findings: applyIndexLintSuppressions({
      files: input.decision.affectedFiles,
      findings: lintRuleOutputs,
      diagnostics: lintDiagnostics,
      ruleDescriptors,
    }),
  });
  const sources = graphSources(graphBuilder.graph);
  const result: ProjectIndexCompilerResult = {
    project: {
      root: input.decision.root,
      ...(input.projectName ? { name: input.projectName } : {}),
      ...(input.configPath ? { configFile: input.configPath } : {}),
      ...(runtime ? { runtimeConfigured: runtime.configured } : {}),
    },
    indexedAt: input.startedAt,
    lint: input.previousIndex.lint,
    facts: {
      lint: input.previousIndex.lint,
      definitions,
      relations,
      diagnostics: lintDiagnostics,
      lintFindings,
      ruleDescriptors,
      sources,
      sourceGraph: input.previousIndex.sourceGraph,
    },
    sources,
    graphEvidence: { dependenciesByFile },
    diagnostics: lintDiagnostics,
    lintFindings,
    ruleDescriptors,
    sourceGraph: input.previousIndex.sourceGraph,
    semanticSourceProfile: semanticSourceProfileForPartial(
      input.decision.affectedFiles,
      dependenciesByFile,
      semanticProfiles,
    ),
  };

  return {
    parsedFiles,
    patch: astIndexPatchFromCompilerResult(result, {
      invalidates: indexInvalidationFromDecision(input.decision),
      finishedAt: new Date().toISOString(),
    }),
  };
}

function runtimeLintContext(
  previousIndex: ProjectIndexSnapshot,
): { readonly configured: boolean } | undefined {
  if (previousIndex.project.runtimeConfigured === undefined) return undefined;
  return { configured: previousIndex.project.runtimeConfigured };
}

function previousSourceForFile(
  previousIndex: ProjectIndexSnapshot,
  file: string,
) {
  return previousIndex.sources.find((source) => source.file === file);
}

function mergeRuleDescriptors(
  descriptors: readonly IndexRuleDescriptor[],
): readonly IndexRuleDescriptor[] {
  const byId = new Map<string, IndexRuleDescriptor>();
  for (const descriptor of descriptors) byId.set(descriptor.id, descriptor);
  return [...byId.values()];
}

function semanticSourceProfileForPartial(
  affectedFiles: readonly string[],
  dependenciesByFile: ReadonlyMap<string, readonly string[]>,
  profiles: readonly SemanticSourceProfileFile[],
): SemanticSourceProfile | undefined {
  if (profiles.length === 0) return undefined;
  const dependencyClosure = [
    ...new Set([
      ...affectedFiles,
      ...[...dependenciesByFile.values()].flatMap((dependencies) => [
        ...dependencies,
      ]),
    ]),
  ].sort();
  const profiledFiles = new Set(profiles.map((profile) => profile.file));
  const sortedProfiles = [...profiles].sort((left, right) =>
    compareCodepoint(left.file, right.file),
  );
  return {
    files: sortedProfiles,
    dependencyClosure,
    sourceBytes: sortedProfiles.reduce(
      (sum, profile) => sum + profile.sourceBytes,
      0,
    ),
    complete: dependencyClosure.every((file) => profiledFiles.has(file)),
  };
}
