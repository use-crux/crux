import { safeId } from "../../../../definitions";
import {
  isIdentifier,
  type Expression,
} from "@typescript/native-preview/unstable/ast";
import { nativeSourceForNode, nativeSourceSnippetForNode } from "../source";
import { nativeZodExpressionToJsonSchema } from "../zod-schema";
import { hasUnsupportedSemanticProperty } from "./guards";
import type { NativeDirectSchemaSpec } from "./manifest";
import { definitionName, nativeCruxCall, propertyInitializer } from "./object";
import { sourceRefEvidenceForDefinition } from "./source-refs";
import type {
  DefinitionFact,
  DefinitionSourceEvidence,
  NativeDefinition,
  NativeDependencyEvidence,
  NativeSourceBinding,
  NativeVariable,
  SourceRefFact,
} from "./types";

/** Resolves a direct-projector variable into one manifest-backed definition. */
export function nativeDefinition(
  variable: NativeVariable,
): NativeDefinition | undefined {
  const call = nativeCruxCall(variable.initializer);
  if (!call) return undefined;
  const name = definitionName(call.primitive, call.object, variable.name);
  if (!name) return undefined;
  return {
    variable,
    primitive: call.primitive,
    object: call.object,
    kind: call.primitive.definitionKind,
    name,
    id: `${call.primitive.definitionKind}:${safeId(name)}`,
  };
}

/** Projects schema metadata and authored source refs for one native definition. */
export function definitionSourceEvidence(
  definition: NativeDefinition,
  variables: ReadonlyMap<string, NativeVariable>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): DefinitionSourceEvidence | undefined {
  if (hasUnsupportedSemanticProperty(definition, bindings)) return undefined;
  const entries: Array<NonNullable<ReturnType<typeof schemaEvidence>>> = [];
  for (const spec of definition.primitive.schema) {
    const expression = propertyInitializer(definition.object, spec.property);
    if (!expression) continue;
    const entry = schemaEvidence(definition, spec, variables, expression);
    if (!entry) return undefined;
    entries.push(entry);
  }
  const sourceRefs = sourceRefEvidenceForDefinition(definition, bindings);
  if (!sourceRefs) return undefined;
  return {
    metadata: Object.fromEntries(
      entries.map((entry) => [entry.metadataKey, entry.schema]),
    ),
    sourceRefs: [...entries.map((entry) => entry.sourceRef), ...sourceRefs],
  };
}

/** Creates the canonical definition fact after all direct evidence has resolved. */
export function definitionFact(
  definition: NativeDefinition,
  sourceEvidence: DefinitionSourceEvidence | undefined,
  dependencyEvidence: NativeDependencyEvidence | undefined,
): DefinitionFact {
  return {
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    fidelity: "resolved",
    status: "active",
    metadata: {
      ...(sourceEvidence?.metadata ?? {}),
      ...(dependencyEvidence?.facts ? { facts: dependencyEvidence.facts } : {}),
    },
    sourceRefs: [],
  };
}

function schemaEvidence(
  definition: NativeDefinition,
  spec: NativeDirectSchemaSpec,
  variables: ReadonlyMap<string, NativeVariable>,
  expression: Expression,
):
  | {
      readonly metadataKey: string;
      readonly schema: unknown;
      readonly sourceRef: SourceRefFact;
    }
  | undefined {
  if (!isIdentifier(expression)) return undefined;
  const schemaVariable = variables.get(expression.text);
  if (!schemaVariable) return undefined;
  const schema = nativeZodExpressionToJsonSchema(
    schemaVariable.file,
    schemaVariable.initializer,
    (name) => variables.get(name)?.initializer,
  );
  if (!schema) return undefined;
  return {
    metadataKey: spec.metadataKey,
    schema,
    sourceRef: {
      definitionId: definition.id,
      ref: {
        id: `${definition.id}:source:schema:${spec.property}:${schemaVariable.name}`,
        role: "schema",
        property: spec.property,
        symbol: schemaVariable.name,
        source: nativeSourceForNode(
          schemaVariable.file,
          schemaVariable.declaration,
        ),
        snippet: nativeSourceSnippetForNode(
          schemaVariable.file,
          schemaVariable.declaration,
        ),
        fidelity: "resolved",
        metadata: { schemaKind: "zod", parsedSchema: true },
      },
    },
  };
}
