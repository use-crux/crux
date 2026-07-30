import { activeEvidenceCollector } from "./collector";
import {
  CruxEvidenceError,
  evidenceDestinationQueryFailedError,
  evidenceQueryUnavailableError,
} from "./errors";
import {
  evidenceSubjectKey,
  freezeEvidenceSubject,
  type EvidenceSubject,
} from "./subjects";
import type { EvidenceInspectOptions, EvidenceView } from "./view-types";
import { validateEvidenceSubject } from "./reference-validation";
import { normalizeEvidenceInspectOptions } from "./validation";
import {
  decodeLocalEvidenceCursor,
  encodeLocalEvidenceCursor,
} from "./cursor";
import { currentObservabilityTransport } from "../observability";
import type { EvidenceDestinationInspectRequest } from "./destination";
import { normalizeEvidenceDestinationResult } from "./destination-validation";
import { mergeEvidenceSources } from "./destination-merge";

/** Inspect the active root's immutable evidence snapshot. @internal */
export async function inspectEvidence(
  subject: EvidenceSubject,
  options: EvidenceInspectOptions = {},
): Promise<EvidenceView> {
  const normalizedOptions = normalizeEvidenceInspectOptions(options);
  validateEvidenceSubject(subject);
  const frozenSubject = freezeEvidenceSubject(subject);
  const snapshot = activeEvidenceCollector(false)?.snapshot(frozenSubject);
  const destination = currentObservabilityTransport()?.evidence;
  if (!snapshot && !destination) throw evidenceQueryUnavailableError();
  const role = normalizedOptions.role;
  const subjectKey = evidenceSubjectKey(frozenSubject);
  const includeHistory = normalizedOptions.includeHistory === true;
  const offset =
    destination === undefined &&
    snapshot !== undefined &&
    normalizedOptions.cursor !== undefined &&
    role !== undefined
      ? decodeLocalEvidenceCursor(normalizedOptions.cursor, {
          subject: subjectKey,
          role,
          history: includeHistory,
          version: snapshot.version,
        })
      : 0;
  const limit = normalizedOptions.limit ?? 50;
  const request = Object.freeze({
    subject: frozenSubject,
    ...(role !== undefined ? { role } : {}),
    limit,
    ...(normalizedOptions.cursor !== undefined
      ? { cursor: normalizedOptions.cursor }
      : {}),
    includeHistory,
    includeData: normalizedOptions.includeData === true,
  }) satisfies EvidenceDestinationInspectRequest;
  let destinationResult;
  if (destination) {
    try {
      destinationResult = normalizeEvidenceDestinationResult(
        await destination.inspectEvidence(request),
        request,
      );
    } catch (error) {
      if (CruxEvidenceError.isInstance(error)) throw error;
      throw evidenceDestinationQueryFailedError();
    }
  }

  return Object.freeze({
    subject: frozenSubject,
    source: snapshot ? "active-scope" : "destination",
    inspectedAt: new Date().toISOString(),
    roles: mergeEvidenceSources(snapshot, destinationResult, {
      ...normalizedOptions,
      limit,
      offset,
      ...(destination === undefined &&
      snapshot !== undefined &&
      role !== undefined
        ? {
            cursorForNextPage: (nextOffset: number) =>
              encodeLocalEvidenceCursor({
                subject: subjectKey,
                role,
                history: includeHistory,
                version: snapshot.version,
                offset: nextOffset,
              }),
          }
        : {}),
    }),
  });
}
