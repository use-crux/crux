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
  /** Whether the authored identity is statically proven or only source-local. */
  readonly identity: "static" | "partial";
}

/** Authored facts for one `signalProvider()` definition. */
export interface SignalProviderFacts {
  readonly kind: "signal.provider";
  /** Literal provider identity when statically proven. */
  readonly providerId?: string;
  /** Whether identity is a direct string literal. */
  readonly identity: "static" | "partial";
  /** Nested transport kind when statically proven. */
  readonly transportKind?: "webhook" | "polling" | "stream" | "sse" | "websocket";
  /** Authored transport variable when the transport is not inline. */
  readonly transportVariable?: string;
  /** Literal Signal ids declared in the provider map when proven. */
  readonly signalIds?: readonly string[];
  /** Authored Signal map variable names when proven. */
  readonly signalVariables?: readonly string[];
  /** Whether an `onEvent` property is present (never retains the callback body). */
  readonly hasOnEvent?: boolean;
}

/** Authored facts for one `webhook()`, `polling()`, `stream()`, `sse()`, or `websocket()` transport declaration. */
export interface SignalTransportFacts {
  readonly kind: "signal.transport";
  /** Transport kind retained for diagnostics. */
  readonly transportKind: "webhook" | "polling" | "stream" | "sse" | "websocket";
  /** Whether a `handle` property is present (webhook; never retains the body). */
  readonly hasHandle?: boolean;
  /** Whether a `poll` property is present (polling; never retains the body). */
  readonly hasPoll?: boolean;
  /**
   * Whether an `open` property is present (stream/SSE/WebSocket; never retains the body).
   */
  readonly hasOpen?: boolean;
}

/** Forbidden live-value property names for inert managed transport bindings. */
export const SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS = [
  "request",
  "client",
  "credential",
  "credentials",
  "socket",
  "callback",
  "handle",
  "poll",
  "open",
  "onEvent",
  "secret",
  "token",
  "password",
  "apiKey",
] as const;

/**
 * Forbidden live-value property names proven on an inert binding options object.
 *
 * @remarks These names never belong on `managedTransportBinding()` options.
 * Credentials and raw payloads are never retained in the finding data.
 */
export type SignalTransportBindingLiveField =
  (typeof SIGNAL_TRANSPORT_BINDING_LIVE_FIELDS)[number];

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
    | {
        readonly kind: "literal";
        readonly id: string;
        readonly revision: string;
      }
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
