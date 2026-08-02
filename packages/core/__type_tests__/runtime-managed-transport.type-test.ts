import {
  validateRuntimeAcceptedTransportEnvelope,
  validateRuntimeManagedTransportAdapterDeclaration,
  validateRuntimeManagedTransportBinding,
} from "@use-crux/core/runtime";
import type {
  RuntimeAcceptedTransportEnvelope,
  RuntimeAcceptedTransportPayload,
  RuntimeManagedTransportBinding,
} from "@use-crux/core/runtime";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() =>
    Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const binding = {
  _tag: "RuntimeManagedTransportBinding",
  id: "binding.primary",
  adapter: {
    _tag: "RuntimeManagedTransportAdapter",
    id: "adapter.webhook",
    provider: "example",
    acceptedEnvelopeVersion: 1,
  },
  configRef: { id: "config.transport", revision: "revision.1" },
  target: { kind: "signal", signalId: "orders.received" },
} as const satisfies RuntimeManagedTransportBinding;

type _BindingIdIsLiteral = Expect<Equal<typeof binding.id, "binding.primary">>;
type _AdapterIdIsLiteral = Expect<Equal<typeof binding.adapter.id, "adapter.webhook">>;
type _ConfigRefIsLiteral = Expect<
  Equal<
    typeof binding.configRef,
    { readonly id: "config.transport"; readonly revision: "revision.1" }
  >
>;
type _TargetIsLiteral = Expect<
  Equal<typeof binding.target, { readonly kind: "signal"; readonly signalId: "orders.received" }>
>;
type _PayloadIsDiscriminated = Expect<
  Equal<
    RuntimeAcceptedTransportPayload,
    | {
        readonly kind: "inline-base64url";
        readonly value: string;
        readonly byteLength: number;
        readonly sha256: string;
      }
    | {
        readonly kind: "durable-ref";
        readonly ref: string;
        readonly byteLength: number;
        readonly sha256: string;
      }
  >
>;
type _AdapterValidatorReturn = Expect<
  Equal<
    ReturnType<typeof validateRuntimeManagedTransportAdapterDeclaration>,
    RuntimeManagedTransportBinding["adapter"]
  >
>;
type _BindingValidatorReturn = Expect<
  Equal<ReturnType<typeof validateRuntimeManagedTransportBinding>, RuntimeManagedTransportBinding>
>;
type _EnvelopeValidatorReturn = Expect<
  Equal<ReturnType<typeof validateRuntimeAcceptedTransportEnvelope>, RuntimeAcceptedTransportEnvelope>
>;

declare const envelope: RuntimeAcceptedTransportEnvelope;
// @ts-expect-error Accepted envelope fields are readonly.
envelope.bindingId = "binding.changed";
// @ts-expect-error Nested payload fields are readonly.
envelope.payload.byteLength = 1;
