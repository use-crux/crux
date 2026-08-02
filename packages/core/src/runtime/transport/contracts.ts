import type { JsonValue } from "../../storage/types";

/** Immutable reference to the transport configuration used at acceptance. */
export interface RuntimeTransportConfigRef {
  readonly id: string;
  readonly revision: string;
}

/** Provider-neutral Signal destination for a managed transport binding. */
export interface RuntimeSignalTransportTarget {
  readonly kind: "signal";
  readonly signalId: string;
}

/** Inert declaration of a provider adapter understood by a host edge. */
export interface RuntimeManagedTransportAdapterDeclaration {
  readonly _tag: "RuntimeManagedTransportAdapter";
  readonly id: string;
  readonly provider: string;
  readonly acceptedEnvelopeVersion: 1;
}

/**
 * Inert managed-transport declaration suitable for generated Runtime programs.
 * It contains data only and grants no acceptance or delivery guarantee.
 */
export interface RuntimeManagedTransportBinding {
  readonly _tag: "RuntimeManagedTransportBinding";
  readonly id: string;
  readonly adapter: RuntimeManagedTransportAdapterDeclaration;
  readonly configRef: RuntimeTransportConfigRef;
  readonly target: RuntimeSignalTransportTarget;
}

/** Detached payload retained by an accepted transport envelope. */
export type RuntimeAcceptedTransportPayload =
  | {
      /** Inline unpadded base64url bytes. */
      readonly kind: "inline-base64url";
      readonly value: string;
      readonly byteLength: number;
      readonly sha256: string;
    }
  | {
      /** Durable payload location resolved only by a later runtime phase. */
      readonly kind: "durable-ref";
      readonly ref: string;
      readonly byteLength: number;
      readonly sha256: string;
    };

/**
 * Authenticated provider event reduced to detached, provider-neutral data.
 * Acceptance itself is implemented by a later durable runtime phase.
 */
export interface RuntimeAcceptedTransportEnvelope {
  readonly _tag: "RuntimeAcceptedTransportEnvelope";
  readonly schemaVersion: 1;
  readonly bindingId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly accountId: string;
  readonly eventId: string;
  readonly receivedAt: string;
  readonly authenticatedRouting: Readonly<Record<string, JsonValue>>;
  readonly payload: RuntimeAcceptedTransportPayload;
  readonly configRef: RuntimeTransportConfigRef;
  readonly target: RuntimeSignalTransportTarget;
}
