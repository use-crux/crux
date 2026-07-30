/**
 * Evidence-specific capture transitions for protected source artifacts.
 *
 * @internal
 * @module
 */

import { sha256Hex } from "../content/sha256";
import { canonicalEvidenceJson } from "../evidence/canonical-json";

interface EvidenceSourceCaptureArtifact {
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * Derive evidence-only reference metadata from the canonical safe preview.
 *
 * Ordinary artifact capture intentionally retains its existing generic hash
 * behavior. The protected marker opts an artifact into the durable evidence
 * identity contract.
 */
export function evidenceReferenceMetadata(
  artifact: EvidenceSourceCaptureArtifact,
  preview: unknown,
): { readonly hash: `sha256:${string}`; readonly sizeBytes: number } | undefined {
  if (!hasEvidenceSourceMarker(artifact)) return undefined;
  const bytes = new TextEncoder().encode(canonicalEvidenceJson(preview));
  return {
    hash: `sha256:${sha256Hex(bytes)}`,
    sizeBytes: bytes.byteLength,
  };
}

/** Update only the protected marker's post-policy capture state. */
export function withEvidenceSourceCaptureState<
  T extends EvidenceSourceCaptureArtifact,
>(artifact: T, captureState: "reference" | "not-captured"): T {
  const attributes = artifact.attributes;
  if (!hasEvidenceSourceMarker(artifact)) return artifact;

  const source = attributes!.evidenceSource as Record<string, unknown>;
  if (
    typeof source.evidenceId !== "string" ||
    !Object.keys(source).every(
      (key) => key === "evidenceId" || key === "captureState",
    )
  ) {
    return artifact;
  }
  return {
    ...artifact,
    attributes: {
      evidenceSource: {
        evidenceId: source.evidenceId,
        captureState,
      },
    },
  };
}

function hasEvidenceSourceMarker(
  artifact: EvidenceSourceCaptureArtifact,
): artifact is EvidenceSourceCaptureArtifact & {
  readonly attributes: Readonly<Record<string, unknown>> & {
    readonly evidenceSource: object;
  };
} {
  const attributes = artifact.attributes;
  return (
    attributes !== undefined &&
    Object.keys(attributes).length === 1 &&
    typeof attributes.evidenceSource === "object" &&
    attributes.evidenceSource !== null
  );
}
