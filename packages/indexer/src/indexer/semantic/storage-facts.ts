import type {
  DependencyFacts,
  PrimitiveIntelligence,
  ProjectDefinitionMetadata,
  ProjectRelation,
  ProjectSourceRef,
  StorageFacts,
} from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
  SemanticTarget,
} from "./candidates";
import {
  callExpressionName,
  propertyInitializer,
  semanticDefinitionPatchBase,
  semanticObjectExpression,
  semanticRelation,
  semanticResolvedSourceRef,
  semanticStringLiteralProperty,
  semanticTargetForExpression,
  toExpression,
  unwrapExpression,
} from "./model";
import {
  isSemanticStorageDefinitionKind,
  semanticStorageFactoryDescriptor,
  type SemanticStorageDefinitionKind,
} from "./storage-model";
type StorageReferenceProperty = "storage" | "records" | "search" | "assets";
interface StorageReference {
  readonly property: StorageReferenceProperty;
  readonly expression: SemanticAnalyzerNode<SemanticAnalyzerView>;
  readonly target: SemanticTarget;
}
/** Returns semantic definition enrichments for Storage Beta candidates. */
export function semanticStorageDefinitionEnrichments(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment[] {
  if (isSemanticStorageDefinitionKind(candidate.kind)) {
    return [
      storageDefinitionEnrichment(
        candidate as SemanticDefinitionCandidate & {
          readonly kind: SemanticStorageDefinitionKind;
        },
        view,
      ),
    ];
  }
  if (candidate.kind === "rag.retriever" || candidate.kind === "workspace") {
    const refs = storageReferencesForObject(
      candidateConfigObject(candidate, view),
      view,
    );
    if (refs.length === 0) return [];
    return [primitiveStorageDefinitionEnrichment(candidate, refs, view)];
  }
  return [];
}
/** Returns resolved semantic relations for Storage Beta candidates. */
export function semanticStorageRelationsForCandidate(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  if (candidate.kind === "storage.bundle")
    return storageBundleRelations(candidate, view);
  if (candidate.kind === "storage.scope")
    return storageScopeRelations(candidate, view);
  if (candidate.kind === "rag.retriever" || candidate.kind === "workspace") {
    return primitiveStorageRelations(
      candidate as SemanticDefinitionCandidate & {
        readonly kind: "rag.retriever" | "workspace";
      },
      storageReferencesForObject(candidateConfigObject(candidate, view), view),
      view,
    );
  }
  return [];
}
function storageDefinitionEnrichment(
  candidate: SemanticDefinitionCandidate & {
    readonly kind: SemanticStorageDefinitionKind;
  },
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment {
  const descriptor = semanticStorageFactoryDescriptor(
    candidate.call ? callExpressionName(candidate.call, view) : undefined,
    hasLiteralSparseDimensions(candidateConfigObject(candidate, view), view),
    hasLiteralLexical(candidateConfigObject(candidate, view), view),
  );
  const refs =
    candidate.kind === "storage.bundle"
      ? storageReferencesForObject(
          candidateConfigObject(candidate, view) ?? candidate.object,
          view,
        )
      : [];
  const scope =
    candidate.kind === "storage.scope"
      ? storageScopeReference(candidate, view)
      : undefined;
  const dependencies = storageDependencies(refs);
  const facts = compactStorageFacts({
    kind: candidate.kind,
    variableName: candidate.name,
    backend: descriptor?.backend,
    capabilities: descriptor?.capabilities,
    records: storageReferenceTarget(refs, "records")?.id,
    search: storageReferenceTarget(refs, "search")?.id,
    assets: storageReferenceTarget(refs, "assets")?.id,
    storage: scope?.target.id,
    prefix: scope?.prefix,
  });
  const intelligence: PrimitiveIntelligence = {
    confidence: "semantic",
    ...(dependencies ? { dependencies } : {}),
  };
  const metadata: ProjectDefinitionMetadata = compactRecord({
    exportName: candidate.name,
    variableName: candidate.name,
    kind: candidate.kind,
    backend: descriptor?.backend,
    capabilities: descriptor?.capabilities,
    recordsVariable: storageReferenceVariable(refs, "records", view),
    searchVariable: storageReferenceVariable(refs, "search", view),
    assetsVariable: storageReferenceVariable(refs, "assets", view),
    baseStorageVariable: scope
      ? expressionVariable(scope.expression, view)
      : undefined,
    prefix: scope?.prefix,
    facts,
    intelligence,
  });

  return {
    definition: {
      ...semanticDefinitionPatchBase(candidate),
      metadata,
    },
    sourceRefs: storageSourceRefs(
      candidate.definitionId,
      [...refs, ...(scope ? [scope] : [])],
      view,
    ),
  };
}

function hasLiteralSparseDimensions(
  object: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
): boolean {
  if (!object || !view.syntax.isKind(object, "objectLiteral")) return false;
  const initializer = propertyInitializer(object, "sparseDimensions", view);
  if (!initializer) return false;
  const text = view.syntax.numericLiteralText(
    unwrapExpression(initializer, view),
  );
  return text !== undefined && Number(text) > 0;
}

function hasLiteralLexical(
  object: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
): boolean {
  if (!object || !view.syntax.isKind(object, "objectLiteral")) return false;
  const initializer = propertyInitializer(object, "lexical", view);
  return Boolean(
    initializer && view.syntax.literalValue(unwrapExpression(initializer, view)),
  );
}

function primitiveStorageDefinitionEnrichment(
  candidate: SemanticDefinitionCandidate,
  refs: readonly StorageReference[],
  view: SemanticAnalyzerView,
): SemanticDefinitionEnrichment {
  const dependencies = storageDependencies(refs);
  const indexerId = semanticStringLiteralProperty(
    candidate.object,
    "indexerId",
    view,
  );
  const namespace = semanticStringLiteralProperty(
    candidate.object,
    "namespace",
    view,
  );
  const retrieverFacts =
    candidate.kind === "rag.retriever"
      ? {
          kind: "rag.retriever" as const,
          retrieverId: candidate.name,
          ...(indexerId ? { indexerId } : {}),
          ...(namespace ? { namespace } : {}),
        }
      : undefined;
  return {
    definition: {
      ...semanticDefinitionPatchBase(candidate),
      metadata: {
        facts: retrieverFacts ?? {
          kind: "workspace",
          workspaceId: candidate.name,
        },
        intelligence: {
          confidence: "semantic",
          dependencies,
        },
      },
    },
    sourceRefs: storageSourceRefs(candidate.definitionId, refs, view),
  };
}

function storageBundleRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  return storageReferencesForObject(
    candidateConfigObject(candidate, view) ?? candidate.object,
    view,
  ).flatMap((ref) => {
    const type = bundleRelationType(ref.property);
    return type
      ? [
          semanticRelation(
            candidate,
            type,
            candidate.definitionId,
            ref.target.id,
            view,
          ),
        ]
      : [];
  });
}

function storageScopeRelations(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  const scope = storageScopeReference(candidate, view);
  return scope
    ? [
        semanticRelation(
          candidate,
          "storage.scope.wraps_storage",
          candidate.definitionId,
          scope.target.id,
          view,
        ),
      ]
    : [];
}

function primitiveStorageRelations(
  candidate: SemanticDefinitionCandidate & {
    readonly kind: "rag.retriever" | "workspace";
  },
  refs: readonly StorageReference[],
  view: SemanticAnalyzerView,
): ProjectRelation[] {
  return refs.flatMap((ref) => {
    const type = primitiveRelationType(candidate.kind, ref.property);
    return type
      ? [
          semanticRelation(
            candidate,
            type,
            candidate.definitionId,
            ref.target.id,
            view,
          ),
        ]
      : [];
  });
}

function candidateConfigObject(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  if (view.syntax.isKind(candidate.object, "objectLiteral"))
    return candidate.object;
  const [firstArg] = candidate.call
    ? view.syntax.callArguments(candidate.call)
    : [];
  return firstArg
    ? semanticObjectExpression(firstArg, view, new Set())
    : undefined;
}

function storageReferencesForObject(
  object: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
): StorageReference[] {
  if (!object || !view.syntax.isKind(object, "objectLiteral")) return [];
  return (["storage", "records", "search", "assets"] as const).flatMap(
    (property) => {
      const initializer = propertyInitializer(object, property, view);
      if (!initializer) return [];
      const expression = toExpression(initializer, view);
      const target = semanticTargetForExpression(expression, view);
      return target && storagePropertyMatchesTarget(property, target)
        ? [{ property, expression, target }]
        : [];
    },
  );
}

function storageScopeReference(
  candidate: SemanticDefinitionCandidate,
  view: SemanticAnalyzerView,
): (StorageReference & { readonly prefix?: string }) | undefined {
  if (!candidate.call) return undefined;
  const [storageExpression, prefixExpression] = view.syntax.callArguments(
    candidate.call,
  );
  const target = storageExpression
    ? semanticTargetForExpression(storageExpression, view)
    : undefined;
  if (!target || !storagePropertyMatchesTarget("storage", target))
    return undefined;
  return {
    property: "storage",
    expression: storageExpression,
    target,
    ...(prefixExpression
      ? {
          prefix: view.syntax.stringLiteralText(
            unwrapExpression(prefixExpression, view),
          ),
        }
      : {}),
  };
}

function storagePropertyMatchesTarget(
  property: StorageReferenceProperty,
  target: SemanticTarget,
): boolean {
  switch (property) {
    case "storage":
      return (
        target.kind === "storage.bundle" || target.kind === "storage.scope"
      );
    case "records":
      return target.kind === "storage.recordStore";
    case "search":
      return target.kind === "storage.searchStore";
    case "assets":
      return target.kind === "storage.assetStore";
  }
}

function storageDependencies(
  refs: readonly StorageReference[],
): DependencyFacts | undefined {
  const dependencies = compactRecord({
    storage: uniqueTargets(refs, "storage"),
    storageScopes: uniqueTargets(refs, "storage", "storage.scope"),
    recordStores: uniqueTargets(refs, "records"),
    searchStores: uniqueTargets(refs, "search"),
    assetStores: uniqueTargets(refs, "assets"),
  });
  return Object.keys(dependencies).length > 0 ? dependencies : undefined;
}

function uniqueTargets(
  refs: readonly StorageReference[],
  property: StorageReferenceProperty,
  kind?: SemanticStorageDefinitionKind,
): string[] | undefined {
  const values = refs
    .filter(
      (ref) => ref.property === property && (!kind || ref.target.kind === kind),
    )
    .map((ref) => ref.target.id);
  const unique = [...new Set(values)].sort();
  return unique.length > 0 ? unique : undefined;
}

function storageSourceRefs(
  definitionId: string,
  refs: readonly StorageReference[],
  view: SemanticAnalyzerView,
): ProjectSourceRef[] {
  return refs.flatMap((ref) => {
    const sourceRef = semanticResolvedSourceRef(
      definitionId,
      ref.property,
      "config",
      ref.expression,
      view,
      {
        extensions: { storageConfig: ref.property },
      },
    );
    return sourceRef ? [sourceRef] : [];
  });
}

function bundleRelationType(
  property: StorageReferenceProperty,
): ProjectRelation["type"] | undefined {
  switch (property) {
    case "records":
      return "storage.bundle.uses_record_store";
    case "search":
      return "storage.bundle.uses_search_store";
    case "assets":
      return "storage.bundle.uses_asset_store";
    default:
      return undefined;
  }
}

function primitiveRelationType(
  ownerKind: "rag.retriever" | "workspace",
  property: StorageReferenceProperty,
): ProjectRelation["type"] | undefined {
  return `${ownerKind}.uses_${property === "records" ? "record_store" : property === "search" ? "search_store" : property === "assets" ? "asset_store" : "storage"}`;
}

function storageReferenceTarget(
  refs: readonly StorageReference[],
  property: StorageReferenceProperty,
): SemanticTarget | undefined {
  return refs.find((ref) => ref.property === property)?.target;
}

function storageReferenceVariable(
  refs: readonly StorageReference[],
  property: StorageReferenceProperty,
  view: SemanticAnalyzerView,
): string | undefined {
  const ref = refs.find((entry) => entry.property === property);
  return ref ? expressionVariable(ref.expression, view) : undefined;
}

function expressionVariable(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  return view.syntax.identifierText(unwrapExpression(expression, view));
}

function compactRecord<T extends Record<string, unknown>>(
  input: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function compactStorageFacts(input: StorageFacts): StorageFacts {
  return Object.fromEntries(
    Object.entries(input as unknown as Record<string, unknown>).filter(
      ([, value]) => value !== undefined,
    ),
  ) as unknown as StorageFacts;
}
