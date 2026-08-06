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
