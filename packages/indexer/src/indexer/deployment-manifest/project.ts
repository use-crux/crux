import type {
  IndexDiagnostic,
  ProjectDefinition,
  ProjectIndexDeploymentManifestV1,
  ProjectIndexManifestContentV1,
  ProjectIndexManifestDefinition,
  ProjectIndexManifestRelation,
  ProjectIndexManifestSource,
  ProjectIndexManifestSourceRef,
  ProjectRelation,
} from "@use-crux/core/project-index";
import {
  CruxIdentityTextSchema,
  ProjectIndexDeploymentManifestV1Schema,
  ProjectIndexManifestContentV1Schema,
} from "@use-crux/core/project-index";
import { sanitizeDefinitionSource } from "@use-crux/core/observability";
import {
  canonicalJson,
  canonicalSha256Hex,
  compareUtf8,
  manifestIdForContent,
} from "./canonical";

/** Provenance recorded outside content-addressed manifest bytes. */
export interface ProjectIndexManifestProvenanceInput {
  readonly producerVersion: string;
  readonly staticFrontend: string;
  readonly semanticBackend?: string;
  readonly semanticStatus: "complete" | "disabled" | "partial";
}

/** Inputs for one pure Project Index deployment-manifest projection. */
export interface CreateProjectIndexDeploymentManifestInput {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly definitions: readonly ProjectDefinition[];
  readonly relations: readonly ProjectRelation[];
  readonly provenance: ProjectIndexManifestProvenanceInput;
}

/** Manifest plus deterministic bytes and non-fatal projection diagnostics. */
export interface CreateProjectIndexDeploymentManifestResult {
  readonly manifest: ProjectIndexDeploymentManifestV1;
  readonly canonicalContent: string;
  readonly diagnostics: readonly IndexDiagnostic[];
}

/**
 * Project one compiler snapshot into a privacy-safe, content-addressed manifest.
 *
 * Projection never mutates source facts. Unsafe optional locations and
 * identifiers are omitted, while malformed resolved relations produce a
 * diagnostic and are excluded from content.
 */
export function createProjectIndexDeploymentManifest(
  input: CreateProjectIndexDeploymentManifestInput,
): CreateProjectIndexDeploymentManifestResult {
  const projectId = CruxIdentityTextSchema.parse(input.projectId);
  const definitions = input.definitions
    .filter(
      (definition) =>
        definition.status === undefined || definition.status === "active",
    )
    .map((definition) => projectDefinition(definition, input.projectRoot))
    .sort((left, right) => compareUtf8(left.id, right.id));
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const diagnostics: IndexDiagnostic[] = [];
  const relations = input.relations
    .flatMap((relation) => {
      const endpointsPresent =
        definitionIds.has(relation.from) && definitionIds.has(relation.to);
      if (endpointsPresent || relation.fidelity !== "resolved") {
        return [projectRelation(relation, input.projectRoot)];
      }
      diagnostics.push(missingRelationEndpointDiagnostic(relation));
      return [];
    })
    .sort(compareRelations);
  const content = ProjectIndexManifestContentV1Schema.parse({
    schemaVersion: 1,
    definitions,
    relations,
  });
  const canonicalContent = canonicalJson(content);
  const manifest = ProjectIndexDeploymentManifestV1Schema.parse({
    schemaVersion: 1,
    projectId,
    manifestId: manifestIdForContent(content),
    content,
    provenance: {
      producer: "@use-crux/indexer",
      ...input.provenance,
    },
  });
  return { manifest, canonicalContent, diagnostics };
}

function projectDefinition(
  definition: ProjectDefinition,
  projectRoot: string,
): ProjectIndexManifestDefinition {
  const source = manifestSource(definition.source, projectRoot);
  const sourceRefs = definition.sourceRefs
    ?.flatMap((reference) => {
      const projected = projectSourceRef(reference, projectRoot);
      return projected ? [projected] : [];
    })
    .sort(compareSourceRefs);
  const contract = definition.metadata?.intelligence?.contract;
  const fingerprints =
    definition.fingerprint || contract
      ? {
          ...(definition.fingerprint
            ? { definition: definition.fingerprint }
            : {}),
          ...(contract ? { contract: canonicalSha256Hex(contract) } : {}),
        }
      : undefined;

  return {
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    fidelity: definition.fidelity,
    ...(source ? { source } : {}),
    ...(sourceRefs?.length ? { sourceRefs } : {}),
    ...(fingerprints ? { fingerprints } : {}),
  };
}

function projectSourceRef(
  reference: NonNullable<ProjectDefinition["sourceRefs"]>[number],
  projectRoot: string,
): ProjectIndexManifestSourceRef | undefined {
  const source = manifestSource(reference.source, projectRoot);
  if (!source) return undefined;
  const property = safeOptionalIdentifier(reference.property);
  const symbol = safeOptionalIdentifier(reference.symbol);
  return {
    id: reference.id,
    role: reference.role,
    source,
    fidelity: reference.fidelity,
    ...(property ? { property } : {}),
    ...(symbol ? { symbol } : {}),
  };
}

function projectRelation(
  relation: ProjectRelation,
  projectRoot: string,
): ProjectIndexManifestRelation {
  const source = manifestSource(relation.source, projectRoot);
  return {
    id: relation.id,
    type: relation.type,
    from: relation.from,
    to: relation.to,
    fidelity: relation.fidelity,
    ...(source ? { source } : {}),
  };
}

function manifestSource(
  source: ProjectDefinition["source"],
  projectRoot: string,
): ProjectIndexManifestSource | undefined {
  return sanitizeDefinitionSource(source, { projectRoot });
}

function safeOptionalIdentifier(value: string | undefined): string | undefined {
  if (value === undefined || /[\u0000-\u001f\u007f]/.test(value))
    return undefined;
  return new TextEncoder().encode(value).byteLength <= 200 ? value : undefined;
}

function compareSourceRefs(
  left: ProjectIndexManifestSourceRef,
  right: ProjectIndexManifestSourceRef,
): number {
  const fields: Array<[string, string]> = [
    [left.id, right.id],
    [left.role, right.role],
    [left.property ?? "", right.property ?? ""],
    [left.symbol ?? "", right.symbol ?? ""],
    [left.source.file, right.source.file],
  ];
  for (const [leftField, rightField] of fields) {
    const compared = compareUtf8(leftField, rightField);
    if (compared !== 0) return compared;
  }
  return (
    left.source.line - right.source.line ||
    (left.source.column ?? 0) - (right.source.column ?? 0)
  );
}

function compareRelations(
  left: ProjectIndexManifestRelation,
  right: ProjectIndexManifestRelation,
): number {
  for (const [leftField, rightField] of [
    [left.id, right.id],
    [left.type, right.type],
    [left.from, right.from],
    [left.to, right.to],
  ] as const) {
    const compared = compareUtf8(leftField, rightField);
    if (compared !== 0) return compared;
  }
  return 0;
}

function missingRelationEndpointDiagnostic(
  relation: ProjectRelation,
): IndexDiagnostic {
  return {
    id: `manifest:relation:${relation.id}:missing-endpoint`,
    severity: "warning",
    code: "manifest.relation-endpoint-missing",
    message: `Resolved relation ${relation.id} references a definition excluded from deployment content.`,
    relatedDefinitionIds: [relation.from, relation.to],
  };
}
