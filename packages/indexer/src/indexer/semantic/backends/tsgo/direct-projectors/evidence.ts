import type { IndexPatchFacts } from "../../../../patches";
import type { Project } from "@typescript/native-preview/unstable/sync";
import {
  isCallExpression,
  type SourceFile,
} from "@typescript/native-preview/unstable/ast";
import type { SemanticSourceProfile } from "../../../source-profile";
import {
  collectNativeDirectFileScope,
  nativeBindingMapsByFile,
} from "./bindings";
import { dependencyEvidenceForDefinition } from "./dependencies";
import { isNativeDirectCandidateCallSet } from "./manifest";
import { nativeCruxCall } from "./object";
import { routingEvidenceForDefinition } from "./routing";
import type { TsgoSemanticCompilerView } from "../compiler-view";
import type { TsgoNativeSourceLookup } from "../source-lookup";
import {
  isNativeDirectStorageInitializer,
  nativeDirectStorageEvidence,
} from "./storage";
import { nativeDefinitionMapsByFile, nativeVariableMapsByFile } from "./scope";
import { nativeDirectPromptTextSourceRefs } from "./prompt-text";
import type { NativeVariable, SourceRefFact } from "./types";
import { nativeZodExpressionToJsonSchema } from "../zod-schema";
import {
  definitionFact,
  definitionSourceEvidence,
  nativeDefinition,
} from "./definition-evidence";
import {
  mergeNativeDirectFacts,
  presentValues,
  zipDefinitions,
} from "./evidence-collections";

export interface NativeDirectEvidenceResult {
  readonly facts: IndexPatchFacts;
  readonly supportedFiles: readonly string[];
  readonly unsupportedFiles: readonly string[];
}

/** Returns whether files fit the native TypeScript-Go direct Crux projection. */
export function isNativeDirectCandidate(
  files: readonly string[],
  sourceProfile: SemanticSourceProfile,
): boolean {
  const profilesByFile = new Map(
    sourceProfile.files.map((file) => [file.file, file]),
  );
  return (
    files.length > 0 &&
    files.every((file) => isNativeDirectProfile(profilesByFile.get(file)))
  );
}

/** Returns files whose source profile says they are eligible for direct native projection. */
export function nativeDirectCandidateFiles(
  files: readonly string[],
  sourceProfile: SemanticSourceProfile,
): readonly string[] {
  const profilesByFile = new Map(
    sourceProfile.files.map((file) => [file.file, file]),
  );
  return files
    .filter((file) => isNativeDirectProfile(profilesByFile.get(file)))
    .sort();
}

/** Projects direct-native facts file by file, preserving unsupported files for the shared analyzer. */
export function nativeDirectEvidenceForFiles(
  root: string,
  project: Project,
  files: readonly string[],
  view: TsgoSemanticCompilerView,
  sourceLookup: TsgoNativeSourceLookup,
): NativeDirectEvidenceResult | undefined {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const facts: IndexPatchFacts[] = [];

  for (const file of files) {
    const directFacts = nativeDirectEvidence(
      root,
      project,
      [file],
      view,
      sourceLookup,
    );
    if (directFacts) {
      supported.push(file);
      facts.push(directFacts);
    } else {
      unsupported.push(file);
    }
  }

  if (supported.length === 0) return undefined;
  return {
    facts: mergeNativeDirectFacts(facts),
    supportedFiles: supported.sort(),
    unsupportedFiles: unsupported.sort(),
  };
}

/**
 * Projects a constrained direct Crux source shape directly from the native tsgo AST.
 *
 * The return value is `undefined` for unsupported syntax so callers can fall
 * back to the complete shared semantic analyzer without producing partial facts.
 */
export function nativeDirectEvidence(
  root: string,
  project: Project,
  files: readonly string[],
  view: TsgoSemanticCompilerView,
  sourceLookup: TsgoNativeSourceLookup,
): IndexPatchFacts | undefined {
  const sources = presentValues(
    files.map((file) => project.program.getSourceFile(file)),
  );
  if (!sources) return undefined;

  const scopes = presentValues(
    sources.map((source) => collectNativeDirectFileScope(source)),
  );
  if (!scopes) return undefined;

  const variableGroups = scopes.map((scope) => scope.variables);
  const nativeVariablesByFile = nativeVariableMapsByFile(
    sources,
    variableGroups,
  );
  const nativeBindingsByFile = nativeBindingMapsByFile(scopes);
  const nativeVariables = variableGroups.flat();
  if (
    nativeVariables.some((variable) =>
      hasUnsupportedTopLevelInitializer(variable, nativeVariablesByFile),
    )
  ) {
    return undefined;
  }
  const storageEvidence = nativeDirectStorageEvidence(
    nativeVariables,
    nativeBindingsByFile,
  );
  if (!storageEvidence) return undefined;

  const definitions = nativeVariables.flatMap(
    (variable) => nativeDefinition(variable) ?? [],
  );
  const definitionsByFile = nativeDefinitionMapsByFile(sources, definitions);
  const sourceEvidencePairs = zipDefinitions(
    definitions,
    definitions.map((definition) => {
      const variables = nativeVariablesByFile.get(definition.variable.file);
      const bindings = nativeBindingsByFile.get(definition.variable.file);
      return variables && bindings
        ? definitionSourceEvidence(definition, variables, bindings)
        : undefined;
    }),
  );
  if (!sourceEvidencePairs) return undefined;
  const sourceEvidenceById = new Map(
    sourceEvidencePairs.map(({ definition, value }) => [definition.id, value]),
  );
  const dependencyDefinitions = definitions.filter(
    (definition) => definition.primitive.dependencies.length > 0,
  );
  const dependencyEvidence = dependencyDefinitions.map((definition) => {
    const definitionsByVariable = definitionsByFile.get(
      definition.variable.file,
    );
    return definitionsByVariable
      ? dependencyEvidenceForDefinition(definition, definitionsByVariable)
      : undefined;
  });
  const dependencyEvidencePairs = zipDefinitions(
    dependencyDefinitions,
    dependencyEvidence,
  );
  if (!dependencyEvidencePairs) return undefined;

  const dependencyEvidenceById = new Map(
    dependencyEvidencePairs.map(({ definition, value }) => [
      definition.id,
      value,
    ]),
  );
  const routingEvidence = definitions.map((definition) => {
    const definitionsByVariable = definitionsByFile.get(
      definition.variable.file,
    );
    const bindings = nativeBindingsByFile.get(definition.variable.file);
    return definitionsByVariable && bindings
      ? routingEvidenceForDefinition(
          definition,
          definitionsByVariable,
          bindings,
          view,
        )
      : undefined;
  });
  const routingEvidencePairs = zipDefinitions(definitions, routingEvidence);
  if (!routingEvidencePairs) return undefined;
  const promptTextEvidence = definitions.map((definition) =>
    nativeDirectPromptTextSourceRefs(root, definition, view, sourceLookup),
  );
  if (
    !promptTextEvidence.every((entry): entry is readonly SourceRefFact[] =>
      Boolean(entry),
    )
  ) {
    return undefined;
  }
  const promptTextSourceRefs = promptTextEvidence.flat();

  const emittedDefinitions = definitions.filter((definition) =>
    definition.primitive.emitDefinition === "always"
      ? true
      : Object.keys(sourceEvidenceById.get(definition.id)?.metadata ?? {})
          .length > 0 ||
        Boolean(dependencyEvidenceById.get(definition.id)?.facts),
  );
  const emittedDefinitionsWithSourceEvidence = sourceEvidencePairs.filter(
    ({ definition }) => emittedDefinitions.includes(definition),
  );

  const definitionFacts = emittedDefinitionsWithSourceEvidence.map(
    ({ definition, value }) =>
      definitionFact(
        definition,
        value,
        dependencyEvidenceById.get(definition.id),
      ),
  );

  return {
    definitions: [
      ...definitionFacts,
      ...storageEvidence.definitions,
      ...routingEvidencePairs.flatMap(({ value }) => value.definitions),
    ],
    relations: [
      ...dependencyEvidencePairs.flatMap(({ value }) => value.relations),
      ...storageEvidence.relations,
      ...routingEvidencePairs.flatMap(({ value }) => value.relations),
    ],
    sourceRefs: [
      ...sourceEvidencePairs.flatMap(({ value }) => value.sourceRefs),
      ...dependencyEvidencePairs.flatMap(({ value }) => value.sourceRefs),
      ...storageEvidence.sourceRefs,
      ...routingEvidencePairs.flatMap(({ value }) => value.sourceRefs),
      ...promptTextSourceRefs,
    ],
    diagnostics: [],
  };
}

function isNativeDirectProfile(
  profile: SemanticSourceProfile["files"][number] | undefined,
): boolean {
  if (!profile) return false;
  if (profile.hints?.nativeDirectCruxCandidate !== undefined)
    return profile.hints.nativeDirectCruxCandidate;
  return profile.source
    ? isNativeDirectCandidateCallSet(profile.hints?.cruxCallNames ?? [])
    : false;
}

function hasUnsupportedTopLevelInitializer(
  variable: NativeVariable,
  variablesByFile: ReadonlyMap<SourceFile, ReadonlyMap<string, NativeVariable>>,
): boolean {
  if (nativeCruxCall(variable.initializer)) return false;
  if (isNativeDirectStorageInitializer(variable)) return false;
  if (!isCallExpression(variable.initializer)) return false;
  const variables = variablesByFile.get(variable.file);
  if (!variables) return true;
  return !nativeZodExpressionToJsonSchema(
    variable.file,
    variable.initializer,
    (name) => variables.get(name)?.initializer,
  );
}
