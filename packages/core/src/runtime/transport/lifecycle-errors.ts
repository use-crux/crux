/**
 * Public errors for durable transport envelope lifecycle.
 *
 * @module
 */

/** Raised when acceptance conflicts with a different authenticated payload. */
export class TransportEnvelopeConflictError extends Error {
  readonly code = "TRANSPORT_ENVELOPE_CONFLICT" as const;

  constructor(
    readonly provider: string,
    readonly accountId: string,
    readonly eventId: string,
  ) {
    super(
      `Transport envelope for provider \`${provider}\` account \`${accountId}\` event \`${eventId}\` conflicts with a previously accepted payload.`,
    );
    this.name = "TransportEnvelopeConflictError";
  }
}

/** Raised when a required transport store capability is absent. */
export class TransportStoreMissingError extends Error {
  readonly code = "TRANSPORT_STORE_MISSING" as const;

  constructor() {
    super("The configured Runtime store cannot persist transport envelopes.");
    this.name = "TransportStoreMissingError";
  }
}

/** Raised when an operator replay targets a missing envelope. */
export class TransportEnvelopeNotFoundError extends Error {
  readonly code = "TRANSPORT_ENVELOPE_NOT_FOUND" as const;

  constructor(
    readonly provider: string,
    readonly accountId: string,
    readonly eventId: string,
  ) {
    super(
      `Transport envelope for provider \`${provider}\` account \`${accountId}\` event \`${eventId}\` was not found.`,
    );
    this.name = "TransportEnvelopeNotFoundError";
  }
}

/** Raised when replay is requested for a non-dead-letter envelope. */
export class TransportEnvelopeNotReplayableError extends Error {
  readonly code = "TRANSPORT_ENVELOPE_NOT_REPLAYABLE" as const;

  constructor(
    readonly provider: string,
    readonly accountId: string,
    readonly eventId: string,
    readonly state: string,
  ) {
    super(
      `Transport envelope for provider \`${provider}\` account \`${accountId}\` event \`${eventId}\` cannot be replayed from state \`${state}\`.`,
    );
    this.name = "TransportEnvelopeNotReplayableError";
  }
}
