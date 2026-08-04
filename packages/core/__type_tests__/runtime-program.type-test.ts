import {
  createRuntimeProgram,
  type CreateRuntimeProgramOptions,
  type RuntimeManagedTransportBinding,
  type RuntimeProgram,
  type RuntimeProgramTarget,
} from "@use-crux/core/runtime";
import { flow } from "@use-crux/core/flow";
import type { SignalProvider } from "@use-crux/core/signal/provider";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const targets = [
  { name: "orders.created", kind: "flow" },
] as const satisfies readonly RuntimeProgramTarget[];
const transports = [
  {
    _tag: "RuntimeManagedTransportBinding",
    id: "binding.created",
    adapter: {
      _tag: "RuntimeManagedTransportAdapter",
      id: "adapter.webhook",
      provider: "example",
      acceptedEnvelopeVersion: 1,
    },
    configRef: { id: "config.webhook", revision: "revision.1" },
    target: { kind: "signal", signalId: "orders.created" },
  },
] as const satisfies readonly RuntimeManagedTransportBinding[];

declare const providers: readonly SignalProvider[];

const options = {
  targets,
  providers,
  transports,
} satisfies CreateRuntimeProgramOptions;
const program = createRuntimeProgram(options);
const flowTarget: RuntimeProgramTarget = flow(
  "orders.flow",
  async () => undefined,
);
void flowTarget;

// @ts-expect-error Runtime program targets require an explicit executable kind.
const missingKindTarget: RuntimeProgramTarget = {
  name: "orders.missing-kind",
};
void missingKindTarget;

createRuntimeProgram({
  targets: [],
  // @ts-expect-error Live providers are SignalProvider definitions, not strings.
  providers: ["orders.webhook"],
  transports: [],
});

const liveBinding: RuntimeManagedTransportBinding = {
  ...transports[0],
  // @ts-expect-error Inert bindings cannot carry live Request handles.
  client: new Request("https://example.test"),
};
void liveBinding;

type _ProgramReturn = Expect<Equal<typeof program, RuntimeProgram>>;
type _TargetsAreReadonly = Expect<
  Equal<RuntimeProgram["targets"], readonly RuntimeProgramTarget[]>
>;
type _ProvidersAreReadonly = Expect<
  Equal<RuntimeProgram["providers"], readonly SignalProvider[]>
>;
type _TransportsAreReadonly = Expect<
  Equal<
    RuntimeProgram["transports"],
    readonly RuntimeManagedTransportBinding[]
  >
>;

// @ts-expect-error Runtime program metadata is readonly.
program.manifestHash = "changed";
// @ts-expect-error Runtime program target arrays are readonly.
program.targets.push({ name: "orders.updated", kind: "flow" });
// @ts-expect-error Generated target definitions are readonly.
program.targetDefinitions.pop();
// @ts-expect-error Executable provider arrays are readonly.
program.providers.pop();
// @ts-expect-error Runtime program transport arrays are readonly.
program.transports.pop();
