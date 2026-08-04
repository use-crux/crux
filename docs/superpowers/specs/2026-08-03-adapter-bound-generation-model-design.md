# Adapter-Bound Generation Model Design

Status: **approved API direction awaiting user specification review for issue #338**

Exact TypeScript signatures, JSDoc, and inference mechanics live in the companion
[API contract](./2026-08-03-adapter-bound-generation-model-api.md). This file is
the binding Phase 2 authority for outcome, decisions, ownership, and behavior.

This design amends [Durable Agent Sessions](./2026-07-28-durable-agent-session-design.md)
and the model-amendment and replay rules in
[Adaptive Execution Control](./2026-07-28-adaptive-execution-control-design.md).
It supersedes the rejected idea of placing a provider or SDK executor in
`crux.config` or Node Runtime options.

## Outcome

Each adapter package exposes one binding function. It accepts that adapter's
native model or same-adapter router and returns one frozen `GenerationModel`.
Execution authority therefore follows the existing `model` property:

```ts
export const economy = aiSdk(nativeModel('nebula-text-v2'))

const writer = agent({ id: 'writer', prompt: writerPrompt, model: economy })
await generate(writerPrompt, { input, model: economy })
await parallel({ draft: writer }, { input, model: economy })
await session(writer, { key: 'writer:42' })
await session(unboundWriter, { key: 'writer:43', model: economy })
```

There is no `generate`/executor/adapter sibling property and no global binding.
An Agent carrying a `GenerationModel` is independently executable by Session and
every other provider-neutral Agent consumer.

Resolution precedence is immutable Session override, then Agent model, then
`MissingGenerationModelBindingError`. A Session never guesses a provider from a
raw model.

## Decisions

1. **Adapter-bound value, not config.** Portable authority is a frozen value on
   the existing `model` slot. Config and Runtime options do not bind providers.
2. **Core is provider-neutral.** Core owns value, identity, capability, and
   resolution contracts. Adapter packages own native types and execution.
3. **One public binding per adapter.** Each adapter exposes exactly one
   one-argument binding function beside its existing direct generation
   functions. Callers never supply capabilities.
4. **Adapter-authoring seam only.** `defineGenerationModel` installs Core
   metadata and the unexported opaque runtime symbol. It is not a user-facing
   executor escape hatch and not a registry. Application code never imports it
   to bypass binding.
5. **Exact capabilities when possible.** Literal native evidence yields exact
   readonly capability tuples. Broad native interfaces yield conservative
   static evidence and require generated-program preflight. Known missing
   required facets are rejected at compile time.
6. **Session inference stays simple.** `M` is inferred from the plain `model`
   property; the compatibility guard is intersected outside that inference.
7. **Durable identity is semantic.** Adapter identity carries an
   execution-contract version, not an npm/package version. Model definition
   fingerprint is a stable semantic binding-compatibility fingerprint.
   Compatible releases with an unchanged semantic fingerprint permit pinned
   replay.
8. **Static ownership for durable use.** Durable bindings must be statically
   discoverable; dynamic construction is diagnosed and rejected by preflight.

## Ownership and construction

### Core vs adapter

Core freezes the returned wrapper and Core metadata. It does not mutate or
deep-freeze the adapter-native object. The opaque `GenerationRuntimePort` is a
Core interface implemented inside each adapter; it can construct the existing
`AgentExecutor` and execute other managed operations without Core importing an
SDK. Adapter packages cannot assign the opaque runtime symbol directly; they
call `defineGenerationModel` after deriving identity and capabilities.

`GenerationModelDefinition.id` is the adapter-derived, secret-free logical
identity. Its fingerprint covers adapter identity/execution-contract version,
normalized model/router identity, capabilities, stable native-model
attestations, and route structure that affect durable execution. It excludes
ordinary generated-artifact and package changes; definition-upgrade
compatibility is a separate Session concern. Custom clients or middleware that
hide execution semantics must first use that adapter's existing stable-identity
mechanism. Credentials, secret-bearing endpoints, functions, and SDK objects
never enter either field.

The capability manifest is exhaustive across all managed operation families,
even though Agent Session currently needs language facets. Adding a portable
facet extends this contract rather than creating a Session-only capability type.

### Adapter binding

`aiSdk` (and each other adapter's neutral package function) accepts an
adapter-owned source covering every native operation model type and same-adapter
router that package supports. Unsupported operation families remain empty
capability tuples on the returned value. Runtime derivation validates complete
capabilities from native identity, metadata, and the adapter catalog.

Raw adapter-native models and native routers remain accepted by a call already
made through that adapter because the call itself supplies authority.
Provider-neutral durable APIs accept only `GenerationModel`.

Same-adapter routers may be wrapped once with the adapter function.
Cross-adapter routing composes bound leaves. Do not wrap a cross-adapter router
with one adapter. Core treats a router or fallback as a `GenerationModel` only
when every reachable leaf is bound. The runtime manifest intersects every
reachable leaf, so no route can promise a facet another route lacks. Compile-time
intersection is exact only when every leaf has literal evidence; broad evidence
is conservative and has no static guarantee, so generated-program preflight
validates required facets before state or provider I/O. The selected leaf
retains its own adapter identity/version. Route profiles remain intact.

If a consumer graph requires several operation families, its bound value or
bound route must declare all required facets; unsupported families stay empty
tuples and do not invent support.

### Agent and Session behavior

Agent retains the exact model type instead of widening a present model to
`TModel | undefined`. Session uses one conditional signature, not an overload
family. It preserves exact Agent input/output and leaves `model` optional when
the Agent is already bound. A raw native Agent model does not satisfy the bound
branch, so Session requires a bound override.

`RequiredLanguageCapabilities` always requires text generation, adds Tool calls
when the effective Agent graph exposes Tools, adds structured output for an
output schema, and adds statically visible input modalities. Only a statically
proven missing facet is rejected at compile time. Broad evidence permits the
call without a compile-time guarantee and requires generated-program preflight.
Dynamic context, route, Tool, and media requirements are checked during that
preflight before Session state or provider I/O.

Composition-level and `prepareStep` model amendments use the same model slot and
compatibility relation. In durable execution, an amendment may select only a
statically declared `GenerationModel`. It changes the next semantic plan, never
the Session's immutable override or Agent definition.

## Static ownership and generated Runtime

Durable bindings are statically discoverable:

- an exported binding is its own Project Index definition;
- an inline binding directly inside an exported Agent's `model` field is owned
  by that Agent definition;
- a Session override must reference an exported, statically declared binding or
  bound route; and
- computed imports, conditional construction, request-local wrapping, unresolved
  aliases, and dynamic native identifiers are diagnosed by Index/LSP/build and
  rejected by runtime preflight.

The Indexer records module/export ownership, adapter identity/version, definition
identity/fingerprint, normalized identity, exact capabilities, reachable leaves,
and Agent/Session/amendment refs. First-party adapters contribute explicit
compiler declarations; third-party adapters use explicit Indexer Extension
manifests. There is no implicit discovery or mutable registry.

The existing generated Runtime Program imports Agent targets and every
referenced static binding. It adds canonically ordered generation-model
declarations beside target declarations, includes them in the program manifest
hash, and associates an Agent target with its owned/default binding refs.
Generated host entries reuse that program in local, Node, serverless, and Convex
targets. They do not generate a second worker or resolver.

Runtime resolution extends the existing target resolver: resolve the Agent
target, select Session override then Agent binding, verify the generated
definition and the selected plan's semantic compatibility evidence, intersect
required capabilities, and obtain the adapter executor from the selected value's
opaque port. `RuntimeProgram` remains immutable; Core gains no provider
dependency.

Keep production modules below 300 lines by splitting
`generation-model/contract.ts`, `capabilities.ts`, `identity.ts`, and
`runtime-resolution.ts`; adapter binding implementations and Indexer
projection/generation remain in their owning packages.

## Durable identity, selection, and replay

Session creation stores only the chosen static definition ref, its stable
binding compatibility fingerprint, the Agent definition ref/fingerprint, and the
Runtime Program manifest hash as provenance. Reopening the same Session with a
different override or effective Agent binding is an immutable-creation conflict.

Each sealed provider plan additionally records the selected normalized router
path, leaf model identity, leaf adapter identity/version, capability
fingerprint, and preparation decision identity. Records never contain native
clients, closures, credentials, headers, SDK objects, or execution ports.

Exact network retry and crash recovery reuse the sealed selection and accepted
model amendment; they do not rerun the router, binding function, or preparation
callback. A new semantic fallback/route attempt creates and commits a new plan
under the existing adaptive-execution rules. Context-overflow recovery may
derive only its already-authorized linked plan.

Hard replay checks compare the stable binding compatibility fingerprint and the
sealed selected-plan evidence. Ordinary generated-artifact or package changes are
provenance, not automatic conflicts: compatible releases with an unchanged
semantic fingerprint allow pinned replay. A definition upgrade is governed
separately by the Session definition-upgrade rules. If the loaded binding cannot
satisfy pinned semantic compatibility or selected-plan evidence, recovery fails
safely with `GenerationModelArtifactMismatchError`; it never substitutes the
current binding.

## Errors and diagnostics

Generation binding failures use structured Runtime errors with `code`,
`whatFailed`, `why`, `whatStillWorks`, and `nextStep`. Required codes are:

- `GENERATION_MODEL_BINDING_MISSING` — neither Session nor Agent supplies a
  bound value;
- `GENERATION_MODEL_NOT_STATIC` — durable use cannot resolve static ownership;
- `GENERATION_MODEL_CONFLICT` — reopen supplies a different immutable binding;
- `GENERATION_MODEL_ARTIFACT_MISMATCH` — loaded code cannot satisfy pinned
  semantic compatibility or selected-plan evidence;
- `GENERATION_CAPABILITY_MISSING` — a required facet is absent from at least one
  reachable leaf; and
- `GENERATION_ADAPTER_UNAVAILABLE` — the imported binding lacks its expected
  execution port/version.

Index/LSP findings point to the model expression, the owning Agent or Session
call, the missing leaf/facet, and the smallest static rewrite. Devtools show safe
binding identity, route and selected leaf, capability decision, definition
fingerprints, and replay/conflict evidence, never credentials or native objects.

## Environment and credential DX

- **Local:** the development generator imports bindings into the same Runtime
  Program and preflights them before the first Session mutation. A memory runtime
  states that restart guarantees are absent.
- **Node plus durable store worker:** the one existing worker loads the generated
  program; adapter-native clients read environment or secret-store credentials
  there.
- **Serverless:** each generated handler imports the same program. Session
  availability still requires the durable continuation capabilities from the
  Session design.
- **Convex:** the generated target action imports the Agent and bindings; the
  existing action boundary executes the selected adapter port.
- **Testing:** export a frozen fake binding with exact capabilities and a
  deterministic executor. Tests pass it through `model`, with no executor-only
  escape hatch.
- **Per tenant:** application logic chooses among exported static bindings before
  Session creation. Large tenant sets use a statically owned adapter-native
  credential resolver whose source contributes to the artifact fingerprint;
  tenant secrets and identifiers do not. Reopen cannot repin a tenant to another
  binding.
- **Credentials:** bindings may capture clients or secret resolvers in memory, but
  durable records contain only secret-free identity. Missing, rotated, or
  unauthorized credentials produce normalized operational failure, not model
  substitution.
- **Multi-provider routing:** compose exported bound leaves in Core
  routers/fallbacks. Capability intersection and selected-leaf evidence remain
  provider-neutral.

Docs teach the bound-Agent path first, then Session override, direct native
calls, static multi-provider routing, credentials, and replay/conflict behavior.
They state that config and Runtime options do not bind providers.

## TDD acceptance

Implementation proceeds in red-green slices:

1. compile-time fixtures prove conditional Session options, exact input/output
   inference, raw-native rejection, route intersections, and no
   overload/assertion escape;
2. adapter contract tests prove frozen values, stable secret-free identity,
   complete literal capabilities, same-adapter routing, and opaque execution;
3. Index/LSP fixtures prove exported ownership, inline Agent ownership,
   Session-reference requirements, dynamic-form diagnostics, and generated
   imports;
4. Runtime tests prove precedence, capability preflight before mutation, one
   target resolver/worker, and every structured error;
5. durable tests prove create/reopen conflict, sealed selection, exact retry,
   crash replay, credential exclusion, and artifact mismatch failure; and
6. shared adapter conformance covers language, Tools, structured output,
   streaming, all declared future operation facets, routing, and model
   amendments.

Acceptance requires all six slices, relevant Project Index cache-identity
updates when output changes, generated Runtime artifact fixtures, adapter
parity, focused docs, and no compatibility or deprecation scaffolding.

## Rejected alternatives

- global provider, SDK, executor, or model binding in config or Runtime options;
- a separate Session adapter/executor option;
- serializing clients, functions, credentials, or native SDK values;
- provider dependencies in Core;
- mutable/global registries or implicit package discovery;
- a second generated worker, target resolver, Thread identity, or Work identity;
  and
- weakening router capabilities to the selected leaf before selection.
