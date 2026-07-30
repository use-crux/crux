/**
 * Opaque proof that Core prepared and locally published a native artifact.
 *
 * @internal
 * @module
 */

import type {
  CapturedObservabilityContext,
  CruxArtifactId,
  CruxArtifactKind,
  ObserveArtifactOptions,
} from "../observability";
import { observe } from "../observability";
import {
  prepareObservabilityArtifact,
  publishPreparedObservabilityBatch,
  reportPreparedObservabilityFailure,
} from "../observability/observe";

declare const nativeEvidenceArtifactBrand: unique symbol;

/**
 * In-process capability for one successfully prepared native artifact.
 *
 * @remarks The capability exposes no artifact metadata or payload, cannot be
 * constructed structurally, and has no serialized or cross-process meaning.
 */
export interface NativeEvidenceArtifactCapability {
  readonly [nativeEvidenceArtifactBrand]: true;
}

interface NativeEvidenceArtifactState {
  readonly artifactId: CruxArtifactId;
  readonly context: CapturedObservabilityContext;
  readonly kind: CruxArtifactKind;
}

class NativeEvidenceArtifactCapabilityImpl implements NativeEvidenceArtifactCapability {
  declare readonly [nativeEvidenceArtifactBrand]: true;
}

const nativeEvidenceArtifactStates = new WeakMap<
  NativeEvidenceArtifactCapability,
  NativeEvidenceArtifactState
>();

/**
 * Prepare and locally publish one artifact for a first-party native producer.
 *
 * @remarks Capture, configured preview redaction, last-mile privacy,
 * sanitization, and validation run exactly once. A returned capability proves
 * local publication/enqueue only; it does not prove destination acceptance.
 */
export function emitNativeEvidenceArtifact(
  options: ObserveArtifactOptions,
): NativeEvidenceArtifactCapability | undefined {
  const context = captureNativeContext();
  if (context === undefined) return undefined;

  const prepared = prepareObservabilityArtifact(options, true);
  if (!prepared.ok) {
    reportPreparedObservabilityFailure(prepared);
    return undefined;
  }
  publishPreparedObservabilityBatch([prepared.record]);
  const capability = Object.freeze(new NativeEvidenceArtifactCapabilityImpl());
  nativeEvidenceArtifactStates.set(
    capability,
    Object.freeze({
      artifactId: prepared.record.artifactId,
      context,
      kind: prepared.record.kind,
    }),
  );
  return capability;
}

/** Read the canonical artifact reference needed by an existing domain edge. */
export function nativeEvidenceArtifactRef(
  capability: NativeEvidenceArtifactCapability,
): Readonly<{
  id: CruxArtifactId;
  kind: CruxArtifactKind;
}> {
  const state = nativeEvidenceArtifactState(capability);
  return Object.freeze({ id: state.artifactId, kind: state.kind });
}

/** Resolve the private state after checking the runtime capability brand. */
export function nativeEvidenceArtifactState(
  capability: NativeEvidenceArtifactCapability,
): NativeEvidenceArtifactState {
  const state = nativeEvidenceArtifactStates.get(capability);
  if (state === undefined) {
    throw new TypeError(
      "Native evidence requires an artifact capability created by Core.",
    );
  }
  return state;
}

function captureNativeContext(): CapturedObservabilityContext | undefined {
  const context = observe.captureContext();
  if (context === undefined) return undefined;
  return Object.freeze({
    ...context,
    spanStack: Object.freeze([...context.spanStack]),
  });
}
