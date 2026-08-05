/** Session-specific public errors. */

import { CruxRuntimeError } from "../runtime/engine/errors";

/** Raised when a stable key is already bound to another Session target. */
export class SessionIdentityConflictError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "SESSION_IDENTITY_CONFLICT";

  constructor(key: string) {
    super(`Session key "${key}" is already bound to a different target.`);
    this.name = "SessionIdentityConflictError";
  }
}

/** Raised when no Session exists for a key in the active Runtime namespace. */
export class SessionNotFoundError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "SESSION_NOT_FOUND";

  constructor(key: string) {
    super(`Session key "${key}" was not found in this Runtime namespace.`);
    this.name = "SessionNotFoundError";
  }
}

/** Raised when an input cannot be durably accepted by a Session. */
export class SessionInputError extends TypeError {
  /** Stable machine-readable error code. */
  readonly code = "SESSION_INPUT_INVALID";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SessionInputError";
  }
}

/** Raised when the active Runtime store does not support Sessions. */
export class SessionCapabilityError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "SESSION_UNSUPPORTED";

  constructor() {
    super("The configured Runtime store cannot persist Sessions.");
    this.name = "SessionCapabilityError";
  }
}

/** Raised before persistence when an Agent Session has no executable model. */
export class GenerationModelBindingError extends CruxRuntimeError {
  constructor() {
    super({
      code: "GENERATION_MODEL_BINDING_MISSING",
      whatFailed: "The Session could not select an executable generation model.",
      why: "Neither the Session nor its Agent has an adapter-bound GenerationModel.",
      whatStillWorks: "Other Runtime targets and Sessions with bound models remain available.",
      nextStep: "Bind an adapter GenerationModel on the Agent or pass one to session().",
    });
    this.name = "GenerationModelBindingError";
  }
}

/** Raised before persistence when a bound model is absent from the RuntimeProgram. */
export class GenerationModelNotStaticError extends CruxRuntimeError {
  constructor() {
    super({
      code: "GENERATION_MODEL_NOT_STATIC",
      whatFailed: "The Session model is not declared by this RuntimeProgram.",
      why: "Durable Session execution can only use a statically declared GenerationModel.",
      whatStillWorks: "Declared models and their Sessions remain available.",
      nextStep: "Add the selected GenerationModel to createRuntimeProgram({ generationModels }).",
    });
    this.name = "GenerationModelNotStaticError";
  }
}

/** Raised before persistence when a model cannot execute an Agent contract. */
export class GenerationModelCapabilityError extends CruxRuntimeError {
  constructor(readonly missing: readonly string[]) {
    super({
      code: "GENERATION_CAPABILITY_MISSING",
      whatFailed: "The selected GenerationModel cannot execute this Agent contract.",
      why: "Its declared language capabilities do not cover the Agent requirements.",
      whatStillWorks: "Sessions using compatible declared models remain available.",
      nextStep: "Select a GenerationModel that supports the Agent's required language capabilities.",
    });
    this.name = "GenerationModelCapabilityError";
  }
}

/** Raised when recovery cannot load the private result prepared for a Session turn. */
export class SessionTurnResultArtifactError extends CruxRuntimeError {
  constructor() {
    super({
      code: "SESSION_TURN_RESULT_ARTIFACT_UNAVAILABLE",
      whatFailed: "The prepared result for a recovering Session turn is unavailable.",
      why: "The stored result artifact is missing or does not match the Session turn checkpoint.",
      whatStillWorks: "Other completed turns and Sessions remain available.",
      nextStep: "Restore the Runtime result store from a consistent backup, then retry the turn.",
    });
    this.name = "SessionTurnResultArtifactError";
  }
}

/** Raised when external ingress targets a closed, killed, or closing-sealed Session. */
export class SessionClosedError extends Error {
  readonly code = "SESSION_CLOSED";

  constructor(sessionId: string) {
    super(
      `Session "${sessionId}" no longer accepts external ingress. It is closed or killed.`,
    );
    this.name = "SessionClosedError";
  }
}

/** Raised when a handle method targets a deleted Session tombstone. */
export class SessionDeletedError extends Error {
  readonly code = "SESSION_DELETED";

  constructor(sessionId: string) {
    super(
      `Session "${sessionId}" has been deleted. Only its key tombstone remains.`,
    );
    this.name = "SessionDeletedError";
  }
}

/** Raised when delete is requested while the Session is still open or draining. */
export class SessionNotClosedError extends Error {
  readonly code = "SESSION_NOT_CLOSED";

  constructor(sessionId: string) {
    super(
      `Session "${sessionId}" must be closed or killed before delete(). Open and closing Sessions remain Thread owners.`,
    );
    this.name = "SessionNotClosedError";
  }
}

/** Raised when a stable key was deliberately ended and cannot be recreated. */
export class SessionTombstonedError extends Error {
  readonly code = "SESSION_TOMBSTONED";

  constructor(key: string) {
    super(
      `Session key "${key}" is tombstoned and cannot silently resurrect a deleted lifecycle.`,
    );
    this.name = "SessionTombstonedError";
  }
}

/** Raised when a lifecycle transition is illegal for the current durable state. */
export class SessionLifecycleError extends Error {
  readonly code = "SESSION_LIFECYCLE_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "SessionLifecycleError";
  }
}
