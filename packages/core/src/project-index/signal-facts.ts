/**
 * Privacy-safe Project Index facts for Signal providers and transport bindings.
 *
 * @module
 */

/** Authored facts for one `signal()` definition. */
export interface SignalFacts {
  readonly kind: "signal";
  /** Literal Signal identity when statically proven. */
  readonly signalId?: string;
}

/** Authored facts for one `signalProvider()` definition. */
export interface SignalProviderFacts {
  readonly kind: "signal.provider";
  /** Literal provider identity when statically proven. */
  readonly providerId?: string;
  /** Whether identity is a direct string literal. */
  readonly identity: "static" | "partial";
  /** Nested transport kind when statically proven. */
  readonly transportKind?: "webhook";
  /** Authored transport variable when the transport is not inline. */
  readonly transportVariable?: string;
  /** Literal Signal ids declared in the provider map when proven. */
  readonly signalIds?: readonly string[];
  /** Authored Signal map variable names when proven. */
  readonly signalVariables?: readonly string[];
  /** Whether an `onEvent` property is present (never retains the callback body). */
  readonly hasOnEvent?: boolean;
}

/** Authored facts for one `webhook()` transport declaration. */
export interface SignalTransportFacts {
  readonly kind: "signal.transport";
  /** Transport kind retained for diagnostics. */
  readonly transportKind: "webhook";
  /** Whether a `handle` property is present (never retains the handle body). */
  readonly hasHandle?: boolean;
}

/**
 * Forbidden live-value property names proven on an inert binding options object.
 *
 * @remarks These names never belong on `managedTransportBinding()` options.
 * Credentials and raw payloads are never retained in the finding data.
 */
export type SignalTransportBindingLiveField =
  | "request"
  | "client"
  | "credential"
  | "credentials"
  | "socket"
  | "callback"
  | "handle"
  | "onEvent"
  | "secret"
  | "token"
  | "password"
  | "apiKey";

/** Authored facts for one `managedTransportBinding()` declaration. */
export interface SignalTransportBindingFacts {
  readonly kind: "signal.transportBinding";
  /** Literal binding identity when statically proven. */
  readonly bindingId?: string;
  /** Whether binding identity and required refs are statically proven. */
  readonly identity: "static" | "partial";
  /** Authored provider variable bound by this declaration. */
  readonly providerVariable?: string;
  /** Resolved provider definition id when statically proven. */
  readonly providerDefinitionId?: string;
  /** Secret-free provider identity required as Runtime program authority. */
  readonly providerId?: string;
  /** Optional adapter id when statically proven. */
  readonly adapterId?: string;
  /** Canonical config reference when statically proven. */
  readonly configRef?:
    | { readonly kind: "literal"; readonly id: string; readonly revision: string }
    | { readonly kind: "partial" }
    | { readonly kind: "dynamic" };
  /** Signal target id when statically proven. */
  readonly signalId?: string;
  /** Signal target resolution classification. */
  readonly target?:
    | { readonly kind: "signal"; readonly signalId: string }
    | { readonly kind: "unresolved" }
    | { readonly kind: "dynamic" };
  /**
   * Explicit live-value property names authored on the options object.
   *
   * @remarks Presence proves an invalid inert-binding shape. Values are never retained.
   */
  readonly liveFields?: readonly SignalTransportBindingLiveField[];
}
