/**
 * Portable deployment identity and Project Index manifest contracts.
 *
 * This module owns only provider-neutral data shapes and validation. Manifest
 * projection, canonical serialization, and hashing remain compiler concerns in
 * `@use-crux/indexer` and are intentionally unreachable from runtime graphs.
 *
 * @module
 */

import { z } from "zod";
import type {
  DefinitionFidelity,
  ProjectDefinitionKind,
  ProjectRelationFidelity,
  ProjectSourceRefRole,
} from "./index";
import {
  DefinitionFidelitySchema,
  ProjectDefinitionKindSchema,
  ProjectSourceRefRoleSchema,
} from "./index";

/** Schema version for privacy-safe Project Index deployment manifests. */
export const PROJECT_INDEX_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Content-addressed identity of normalized Project Index manifest content. */
export type ProjectIndexManifestId = `pim_${string}`;

/** Runtime identity connecting execution evidence to one compiled project. */
export interface CruxDeploymentIdentity {
  /** Stable logical project identity supplied by the application or build. */
  readonly projectId: string;
  /** Content identity of one normalized Project Index deployment manifest. */
  readonly manifestId?: ProjectIndexManifestId;
  /** Opaque CI or host deployment identity, excluded from manifest hashing. */
  readonly deploymentId?: string;
}

/** Sanitized repo-relative source pointer included in manifest content. */
export interface ProjectIndexManifestSource {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

/** Privacy-safe supporting source reference for a manifest definition. */
export interface ProjectIndexManifestSourceRef {
  readonly id: string;
  readonly role: ProjectSourceRefRole;
  readonly property?: string;
  readonly symbol?: string;
  readonly source: ProjectIndexManifestSource;
  readonly fidelity: "resolved" | "partial";
}

/** Privacy-safe projection of one Project Index definition. */
export interface ProjectIndexManifestDefinition {
  readonly id: string;
  readonly kind: ProjectDefinitionKind;
  readonly name: string;
  readonly fidelity: DefinitionFidelity;
  readonly source?: ProjectIndexManifestSource;
  readonly sourceRefs?: readonly ProjectIndexManifestSourceRef[];
  readonly fingerprints?: {
    /** Existing Project Definition fingerprint copied unchanged. */
    readonly definition?: string;
    /** SHA-256 of canonical compiler-owned contract facts. */
    readonly contract?: string;
  };
}

/** Privacy-safe projection of one Project Index relation. */
export interface ProjectIndexManifestRelation {
  readonly id: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly fidelity: ProjectRelationFidelity;
  readonly source?: ProjectIndexManifestSource;
}

/** The only bytes used to derive a Project Index manifest ID. */
export interface ProjectIndexManifestContentV1 {
  readonly schemaVersion: 1;
  readonly definitions: readonly ProjectIndexManifestDefinition[];
  readonly relations: readonly ProjectIndexManifestRelation[];
}

/** Versioned deployment manifest envelope produced by `@use-crux/indexer`. */
export interface ProjectIndexDeploymentManifestV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly manifestId: ProjectIndexManifestId;
  readonly content: ProjectIndexManifestContentV1;
  readonly provenance: {
    readonly producer: "@use-crux/indexer";
    readonly producerVersion: string;
    readonly staticFrontend: string;
    readonly semanticBackend?: string;
    readonly semanticStatus: "complete" | "disabled" | "partial";
  };
}

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const MANIFEST_ID_PATTERN = /^pim_[0-9a-f]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

/** Validate stable project and opaque deployment identifiers. */
export const CruxIdentityTextSchema = z.string().refine(isValidIdentityText, {
  message:
    "Identity must be trimmed, contain 1-200 UTF-8 bytes, and contain no control characters.",
});

/** Validate a content-addressed Project Index manifest ID. */
export const ProjectIndexManifestIdSchema = z.custom<ProjectIndexManifestId>(
  (value) => typeof value === "string" && MANIFEST_ID_PATTERN.test(value),
  {
    message:
      "Manifest ID must be pim_ followed by 64 lowercase hex characters.",
  },
);

/** Validate deployment identity without reading host environment state. */
export const CruxDeploymentIdentitySchema = z
  .object({
    projectId: CruxIdentityTextSchema,
    manifestId: ProjectIndexManifestIdSchema.optional(),
    deploymentId: CruxIdentityTextSchema.optional(),
  })
  .strict() satisfies z.ZodType<CruxDeploymentIdentity>;

/** Validate a sanitized manifest source pointer. */
export const ProjectIndexManifestSourceSchema = z
  .object({
    file: z.string().refine(isCanonicalManifestPath, {
      message: "Source file must be a canonical repo-relative POSIX path.",
    }),
    line: z.number().int().positive(),
    column: z.number().int().positive().optional(),
  })
  .strict() satisfies z.ZodType<ProjectIndexManifestSource>;

const ProjectIndexManifestIdentifierSchema = z
  .string()
  .min(1)
  .refine(isValidOptionalIdentifier, {
    message:
      "Identifier must contain at most 200 UTF-8 bytes and no control characters.",
  });

/** Validate a privacy-safe source reference. */
export const ProjectIndexManifestSourceRefSchema = z
  .object({
    id: z.string(),
    role: z.lazy(() => ProjectSourceRefRoleSchema),
    property: ProjectIndexManifestIdentifierSchema.optional(),
    symbol: ProjectIndexManifestIdentifierSchema.optional(),
    source: ProjectIndexManifestSourceSchema,
    fidelity: z.enum(["resolved", "partial"]),
  })
  .strict() satisfies z.ZodType<ProjectIndexManifestSourceRef>;

/** Validate a privacy-safe manifest definition. */
export const ProjectIndexManifestDefinitionSchema = z
  .object({
    id: z.string(),
    kind: z.lazy(() => ProjectDefinitionKindSchema),
    name: z.string(),
    fidelity: z.lazy(() => DefinitionFidelitySchema),
    source: ProjectIndexManifestSourceSchema.optional(),
    sourceRefs: z.array(ProjectIndexManifestSourceRefSchema).optional(),
    fingerprints: z
      .object({
        definition: z.string().optional(),
        contract: z.string().regex(SHA256_HEX_PATTERN).optional(),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<ProjectIndexManifestDefinition>;

/** Validate a privacy-safe manifest relation. */
export const ProjectIndexManifestRelationSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    from: z.string(),
    to: z.string(),
    fidelity: z.lazy(() => DefinitionFidelitySchema),
    source: ProjectIndexManifestSourceSchema.optional(),
  })
  .strict() satisfies z.ZodType<ProjectIndexManifestRelation>;

/** Validate canonical content before hashing or persistence. */
export const ProjectIndexManifestContentV1Schema = z
  .object({
    schemaVersion: z.literal(PROJECT_INDEX_MANIFEST_SCHEMA_VERSION),
    definitions: z.array(ProjectIndexManifestDefinitionSchema),
    relations: z.array(ProjectIndexManifestRelationSchema),
  })
  .strict() satisfies z.ZodType<ProjectIndexManifestContentV1>;

/** Validate a complete v1 deployment manifest envelope. */
export const ProjectIndexDeploymentManifestV1Schema = z
  .object({
    schemaVersion: z.literal(PROJECT_INDEX_MANIFEST_SCHEMA_VERSION),
    projectId: CruxIdentityTextSchema,
    manifestId: ProjectIndexManifestIdSchema,
    content: ProjectIndexManifestContentV1Schema,
    provenance: z
      .object({
        producer: z.literal("@use-crux/indexer"),
        producerVersion: z.string().min(1),
        staticFrontend: z.string().min(1),
        semanticBackend: z.string().min(1).optional(),
        semanticStatus: z.enum(["complete", "disabled", "partial"]),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<ProjectIndexDeploymentManifestV1>;

function isValidIdentityText(value: string): boolean {
  const byteLength = utf8ByteLength(value);
  return (
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value) &&
    byteLength >= 1 &&
    byteLength <= 200
  );
}

function isCanonicalManifestPath(value: string): boolean {
  if (
    value.length === 0 ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    value.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return false;
  }

  return value
    .split("/")
    .every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    );
}

function isValidOptionalIdentifier(value: string): boolean {
  return !CONTROL_CHARACTER_PATTERN.test(value) && utf8ByteLength(value) <= 200;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
