import { z } from "zod";

const evidenceId = z.string().regex(/^evidence_[0-9a-f]{16,64}$/u);
const evidenceReferenceHash = /^sha256:[0-9a-f]{64}$/u;

/**
 * Protected identity attached to every canonical inline evidence artifact.
 *
 * @remarks The closed marker lets destinations recognize evidence candidates
 * before applying ordinary artifact capture or persistence policy.
 */
export const EvidenceSourceMarkerSchema = z
  .object({
    evidenceSource: z
      .object({
        evidenceId,
        captureState: z.enum([
          "available",
          "reference",
          "not-captured",
        ]),
      })
      .strict(),
  })
  .strict();

interface EvidenceSourceArtifact {
  readonly contentType: string;
  readonly encoding: string;
  readonly preview?: unknown;
  readonly hash?: string;
  readonly sizeBytes?: number;
  readonly uri?: string;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * Enforce the state-specific evidence candidate envelope.
 *
 * Ordinary artifacts remain forward-compatible. The strict rules apply only
 * when the reserved `evidenceSource` marker is present.
 */
export function validateEvidenceSourceArtifact(
  artifact: EvidenceSourceArtifact,
  context: z.RefinementCtx,
): void {
  if (
    artifact.attributes === undefined ||
    !Object.hasOwn(artifact.attributes, "evidenceSource")
  ) {
    return;
  }

  const marker = EvidenceSourceMarkerSchema.safeParse(artifact.attributes);
  if (!marker.success) {
    for (const issue of marker.error.issues) {
      context.addIssue({
        code: "custom",
        message: issue.message,
        path: ["attributes", ...issue.path],
      });
    }
    return;
  }

  const hasPreview = Object.hasOwn(artifact, "preview");
  const hasHash = Object.hasOwn(artifact, "hash");
  const hasSize = Object.hasOwn(artifact, "sizeBytes");
  const hasUri = Object.hasOwn(artifact, "uri");
  const state = marker.data.evidenceSource.captureState;

  if (artifact.contentType !== "application/json") {
    addShapeIssue(context, "contentType");
  }
  if (
    state === "available" &&
    (artifact.encoding !== "json" ||
      !hasPreview ||
      hasHash ||
      hasSize ||
      hasUri)
  ) {
    addShapeIssue(context, "preview");
  }
  if (
    state === "reference" &&
    (artifact.encoding !== "reference" ||
      hasPreview ||
      hasUri ||
      (hasHash &&
        (typeof artifact.hash !== "string" ||
          !evidenceReferenceHash.test(artifact.hash))))
  ) {
    addShapeIssue(context, "encoding");
  }
  if (
    state === "not-captured" &&
    (artifact.encoding !== "reference" ||
      hasPreview ||
      hasHash ||
      hasSize ||
      hasUri)
  ) {
    addShapeIssue(context, "encoding");
  }
}

function addShapeIssue(context: z.RefinementCtx, field: string): void {
  context.addIssue({
    code: "custom",
    message: "Evidence source artifact shape does not match its capture state",
    path: [field],
  });
}
