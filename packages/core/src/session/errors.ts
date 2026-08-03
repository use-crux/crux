/** Session-specific public errors. */

/** Raised when a stable key is already bound to another Agent target. */
export class SessionIdentityConflictError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "SESSION_IDENTITY_CONFLICT";

  constructor(key: string) {
    super(`Session key "${key}" is already bound to a different Agent.`);
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
    super("The configured Runtime store cannot persist Agent Sessions.");
    this.name = "SessionCapabilityError";
  }
}

/** Raised before persistence when an Agent Session has no executable model. */
export class GenerationModelBindingError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "GENERATION_MODEL_BINDING_MISSING";

  constructor() {
    super("Session requires a bound GenerationModel.");
    this.name = "GenerationModelBindingError";
  }
}

/** Raised before persistence when a bound model is absent from the RuntimeProgram. */
export class GenerationModelNotStaticError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "GENERATION_MODEL_NOT_STATIC";

  constructor() {
    super("Session requires a GenerationModel declared by the RuntimeProgram.");
    this.name = "GenerationModelNotStaticError";
  }
}

/** Raised before persistence when a model cannot execute an Agent contract. */
export class GenerationModelCapabilityError extends Error {
  /** Stable machine-readable error code. */
  readonly code = "GENERATION_CAPABILITY_MISSING";

  constructor(readonly missing: readonly string[]) {
    super(`GenerationModel is missing required capabilities: ${missing.join(", ")}.`);
    this.name = "GenerationModelCapabilityError";
  }
}
