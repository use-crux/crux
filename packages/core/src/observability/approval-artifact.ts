/**
 * Protected identity and validation for deterministic approval artifacts.
 *
 * @internal
 * @module
 */

import { z } from "zod";

import { sha256Hex } from "../content/sha256";
import { canonicalEvidenceJson } from "../evidence/canonical-json";
import type {
  CruxArtifactId,
  CruxArtifactKind,
  CruxAttributes,
  CruxRunId,
} from "./contract";

const APPROVAL_PREFIX = "approval_";
const MAX_APPROVAL_SCALARS = 512;
const MAX_APPROVAL_BYTES = 2_048;
const UTF8_ENCODER = new TextEncoder();

/** Stable occurrence identity shared by request and decision production. */
export interface ApprovalArtifactOccurrence {
  readonly domain: "crux.tool.approval";
  readonly identityEpoch: 1;
  readonly namespace: {
    readonly operationId: CruxRunId;
    readonly runId: CruxRunId;
  };
  readonly approvalId: string;
  readonly slot: "request" | "decision";
}

/** Exact protected attributes carried by one deterministic approval artifact. */
export type ApprovalArtifactAttributes = CruxAttributes & {
  readonly approvalOccurrence: ApprovalArtifactOccurrence;
};

export const ApprovalArtifactAttributesSchema = z
  .object({
    approvalOccurrence: z
      .object({
        domain: z.literal("crux.tool.approval"),
        identityEpoch: z.literal(1),
        namespace: z
          .object({
            operationId: z.string().min(1),
            runId: z.string().min(1),
          })
          .strict(),
        approvalId: z.string().refine(isApprovalId, {
          message: "Invalid tool approval identity",
        }),
        slot: z.enum(["request", "decision"]),
      })
      .strict(),
  })
  .strict();

/** Construct a detached protected occurrence marker. */
export function approvalArtifactAttributes(
  occurrence: ApprovalArtifactOccurrence,
): ApprovalArtifactAttributes {
  const parsed = ApprovalArtifactAttributesSchema.parse({
    approvalOccurrence: occurrence,
  });
  return Object.freeze({
    approvalOccurrence: Object.freeze({
      ...parsed.approvalOccurrence,
      namespace: Object.freeze({
        operationId:
          parsed.approvalOccurrence.namespace.operationId as CruxRunId,
        runId: parsed.approvalOccurrence.namespace.runId as CruxRunId,
      }),
    }),
  });
}

/** Derive the opaque full-SHA-256 artifact identity from the exact marker. */
export function approvalArtifactId(
  attributes: ApprovalArtifactAttributes,
): CruxArtifactId {
  const canonical = canonicalEvidenceJson(attributes);
  return `artifact_${sha256Hex(UTF8_ENCODER.encode(canonical))}` as CruxArtifactId;
}

/** Validate the public approval protocol ID without Unicode normalization. */
export function isApprovalId(value: string): boolean {
  if (
    !value.startsWith(APPROVAL_PREFIX) ||
    hasUnpairedSurrogate(value) ||
    [...value].length > MAX_APPROVAL_SCALARS ||
    UTF8_ENCODER.encode(value).byteLength > MAX_APPROVAL_BYTES
  ) {
    return false;
  }
  const suffix = value.slice(APPROVAL_PREFIX.length);
  const scalars = [...suffix];
  return (
    scalars.length > 0 &&
    !scalars.some(isControlCharacter) &&
    !isApprovalBoundaryWhitespace(scalars[0]!) &&
    !isApprovalBoundaryWhitespace(scalars.at(-1)!)
  );
}

interface ApprovalArtifactRecordShape {
  readonly operationId: string;
  readonly runId: string;
  readonly artifactId: string;
  readonly kind: CruxArtifactKind;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/** Enforce marker, kind/slot, namespace, and derived artifact identity. */
export function validateApprovalArtifact(
  artifact: ApprovalArtifactRecordShape,
  context: z.RefinementCtx,
): void {
  const isApprovalKind =
    artifact.kind === "approval.request" ||
    artifact.kind === "approval.decision";
  const hasMarker =
    artifact.attributes !== undefined &&
    Object.hasOwn(artifact.attributes, "approvalOccurrence");
  if (!isApprovalKind && !hasMarker) return;

  const parsed = ApprovalArtifactAttributesSchema.safeParse(
    artifact.attributes,
  );
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: ["attributes", ...issue.path],
      });
    }
    return;
  }
  const occurrence = parsed.data.approvalOccurrence;
  const expectedKind =
    occurrence.slot === "request"
      ? "approval.request"
      : "approval.decision";
  if (artifact.kind !== expectedKind) addIssue(context, "kind");
  if (
    occurrence.slot === "request" &&
    (occurrence.namespace.operationId !== artifact.operationId ||
      occurrence.namespace.runId !== artifact.runId)
  ) {
    addIssue(context, "attributes");
  }
  if (
    artifact.artifactId !==
    approvalArtifactId(parsed.data as ApprovalArtifactAttributes)
  ) {
    addIssue(context, "artifactId");
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function isControlCharacter(value: string): boolean {
  const code = value.codePointAt(0)!;
  return (code >= 0 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f);
}

function isApprovalBoundaryWhitespace(value: string): boolean {
  const code = value.codePointAt(0)!;
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    (code >= 0x2028 && code <= 0x2029) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function addIssue(context: z.RefinementCtx, field: string): void {
  context.addIssue({
    code: "custom",
    message: "Invalid protected tool approval artifact",
    path: [field],
  });
}
