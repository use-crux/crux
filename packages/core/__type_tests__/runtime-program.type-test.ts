import {
  createRuntimeProgram,
  type CreateRuntimeProgramOptions,
  type RuntimeManagedTransportBinding,
  type RuntimeEffectTarget,
  type RuntimeProgram,
} from "@use-crux/core/runtime";
import type { RecoverableEffectDefinition } from "@use-crux/core/effect";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? true
    : false;
type Expect<Value extends true> = Value;

const targets = [{ name: "orders.created" }] as const;
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
declare const recoverableEffect: RecoverableEffectDefinition<
  { readonly id: string },
  string
>;

const options = {
  targets,
  transports,
  effectTargets: [recoverableEffect],
} satisfies CreateRuntimeProgramOptions;
const program = createRuntimeProgram(options);

type _ProgramReturn = Expect<Equal<typeof program, RuntimeProgram>>;
type _TargetsAreReadonly = Expect<
  Equal<RuntimeProgram["targets"], CreateRuntimeProgramOptions["targets"]>
>;
type _TransportsAreReadonly = Expect<
  Equal<RuntimeProgram["transports"], CreateRuntimeProgramOptions["transports"]>
>;
type _EffectTargetsAreDeclarations = Expect<
  Equal<RuntimeProgram["effectTargets"], readonly RuntimeEffectTarget[]>
>;

// @ts-expect-error Runtime program metadata is readonly.
program.manifestHash = "changed";
// @ts-expect-error Runtime program target arrays are readonly.
program.targets.push({ name: "orders.updated" });
// @ts-expect-error Runtime program transport arrays are readonly.
program.transports.pop();
// @ts-expect-error Runtime Effect target declarations are readonly.
program.effectTargets.push({ id: "customer.update", version: 1 });
