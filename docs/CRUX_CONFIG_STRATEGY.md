# Crux Config Strategy

## Short Version

Crux should have no central registry tax.

The rule is:

> Explicit construction decides behavior. Crux discovery provides visibility.

Or, more simply:

> If it is wired in code, it is wired for Crux.

Users should explicitly choose stores, telemetry, providers, cloud upload, training exports, retention, and other ownership decisions in code or explicit policy. Crux should not magically choose those things.

But once users have written those choices in code, Crux should not make them repeat the wiring in a central `config()` object. The Project Index and runtime evidence should infer the graph.

## Research Basis

The target shape follows established developer-tooling patterns:

- [Vercel project configuration](https://vercel.com/docs/project-configuration): detect ordinary project/framework structure, then use config to override builds, routing, functions, and related policy.
- [Vite config](https://vite.dev/config/): resolve conventional config automatically, with an explicit CLI override when needed.
- [Tailwind CSS v4](https://tailwindcss.com/blog/tailwindcss-v4): remove boilerplate through automatic source detection, ignore generated/dependency paths by default, and provide explicit source overrides.
- [Turborepo configuration](https://turborepo.dev/docs/reference/configuration): config describes task behavior, inputs, cache policy, and environment boundaries, not a duplicate inventory of code.
- [TypeScript discriminated unions and exhaustiveness](https://www.typescriptlang.org/docs/handbook/2/narrowing.html): project-model provenance and diagnostics should be typed as explicit variants so future surfaces handle every state.

The lesson for Crux: infer conventional structure and authored relationships, then make policy,
trust, privacy, cost, persistence, and upload decisions explicit.

## Non-Negotiables

### No Magic Ownership Decisions

Crux must not silently choose:

- a durable store;
- a vector store;
- a provider or model;
- an OTel/cloud export destination;
- a tenant or namespace strategy;
- a retention policy;
- training dataset eligibility;
- raw prompt/output upload;
- production telemetry export;
- destructive workspace permissions.

Those are behavior, privacy, cost, or data-ownership choices. Users must choose them.

### No Duplicate Registration

Crux should not require this:

```ts
config({
  prompts,
  stores: [store],
  memories: [assistantMemory],
  retrievers: [docs],
  setup() {
    // setup
  },
})
```

If `assistantMemory` was constructed with `store`, and a prompt uses `assistantMemory`, that relationship is already authored. If `docs` is used by a prompt, context, or evaluation, that relationship is already authored. If a suite imports a model helper, that dependency is already authored.

Central config should not complete the authored graph.

## What Config Is For

Config remains useful for things that are not naturally present in authored code:

- lint profile and rule overrides;
- source discovery include/exclude overrides;
- third-party indexer extension trust;
- cloud project identity and upload policy;
- training export policy;
- raw-content retention policy;
- unusual monorepo roots;
- custom tokenizer defaults;
- explicit runtime plugins that change behavior;
- explicit telemetry or cloud transports.

Config is policy, trust, override, and boundary declaration. It is not a primitive registry.

## What Crux Can Infer

Crux should infer these from source and runtime evidence:

- project root, package root, workspace root, and package manager;
- framework/runtime signals such as Next, Convex, Expo, Node, or package scripts;
- source roots and path aliases from `tsconfig.json` and package metadata;
- prompts, contexts, tools, agents, flows, compositions, retrieval, memory, workspaces, guardrails, constraints, scorers, and quality suites;
- `use[]` relationships;
- prompt/context tree paths where authored through `createPrompts()` / `createContexts()`;
- memory -> store relationships when a memory is constructed with a store;
- retriever/corpus/indexer -> store relationships when constructed in code;
- tool maps and tool-producing contexts where statically visible;
- evaluation definitions from `*.eval.ts`;
- cassettes and baselines from conventional paths;
- runtime joins from stable IDs and runtime-emitted attributes.

When inference is partial, Crux should emit a diagnostic with a suggested fix. The fix should usually be "make this relationship statically visible" or "add a stable id," not "register it in config."

## What Crux Can Auto-Run Locally

When the user explicitly runs Crux tooling, Crux can safely set up local tooling behavior:

- start the local devtools server;
- run Project Index discovery;
- run source resolver workers;
- run the quality runner;
- use local `.crux/cache`;
- use local `.crux/quality`;
- use the default lint profile;
- attach local observability when `crux dev` provides a local URL;
- emit runtime snapshots to local devtools;
- discover local bridge peers when explicit local env vars exist.

This is not magic ownership. The user invoked Crux locally.

## What Must Stay Explicit

These should require explicit authored code or explicit policy:

- installing OTel or production telemetry plugins;
- enabling cloud upload;
- enabling raw prompt/output capture;
- exporting training datasets;
- declaring third-party indexer extension trust;
- selecting durable stores;
- selecting vector stores;
- selecting model/provider defaults;
- declaring tenant/namespace logic;
- declaring retention and redaction policy;
- enabling destructive tools or workspace writes;
- enabling automatic long-term memory writes.

## Quality Config Is The Current Smell

`packages/backend/crux.config.ts` is a useful example. It currently mixes:

- duplicate graph registration: `prompts`, `contexts`, `tools`;
- local discovery settings: `quality.id`, `quality.dir`, `quality.include`;
- run defaults: concurrency, timeout, replay mode;
- global executor/model setup: `quality.setup`;
- conscious runtime behavior: cost tracking and safety plugins;
- local observability transport wiring.

Those should be split by responsibility.

### Remove Or Infer

These should not be required in config:

- `prompts`;
- `contexts`;
- `tools`;
- `quality.id` when it can default to nearest `package.json` name;
- `quality.dir` when it can default to `.crux/quality`;
- `quality.include` when `evals/**/*.eval.ts` and `**/*.eval.ts` can be discovered;
- `quality.defaults.concurrency` if it is the default;
- `quality.defaults.timeoutMs` if it is the default.

### Move To CLI Or Run Policy

Replay posture is a run decision:

```sh
crux quality run --ci --replay replay-strict
crux quality run --replay live
crux quality run --replay record-new
```

Project config can still set a default replay policy, but CI scripts and run tiers are the clearer primary place.

### Move To Eval-Local Code

`quality.setup` is an ambient service locator. It hides model and executor choices from the eval that needs them.

Instead, suites should import their own helpers:

```ts
// evals/_shared/qualityModels.ts
import { generate } from '@crux/ai'
import { createAIClient, models } from '@packages/ai'

const client = createAIClient()

export const qualityModels = {
  generate,
  structuredFast: client.model(models.structured.fast),
  structuredPowerful: client.model(models.structured.powerful),
}
```

Then a model-backed eval is explicit:

```ts
import { qualityModels } from '../_shared/qualityModels'

export const modeAutoDetectLive = evaluate('prompt.mode-auto-detect.live', {
  task: modeAutoDetectPrompt.withExecutor({
    generate: qualityModels.generate,
    model: qualityModels.structuredFast,
  }),
  replay: { mode: 'replay-strict', cassette: cassette('mode-auto-detect') },
  data: cases,
})
```

The API does not have to look exactly like this, but the dependency should be local to the suite or imported helper, not hidden in global config.

### Keep Explicit Runtime Behavior

These are real behavior choices and should remain explicit somewhere:

- cost tracking plugin;
- safety plugin;
- production telemetry;
- cloud upload;
- raw content capture;
- training export.

They should not sit beside primitive registration.

## Implementation Shape

The stable center should be a resolved Project Model with typed provenance:

```ts
type ProjectModelProvenance =
  | { kind: 'source'; file: string; exportName?: string }
  | { kind: 'runtime'; traceId?: string; attribute: string }
  | { kind: 'filesystem'; path: string; convention: string }
  | { kind: 'config'; path: string; key: string }
  | { kind: 'cli'; flag: string }
```

Diagnostics should also be a discriminated union with stable reason codes:

```ts
type ProjectModelDiagnostic =
  | { kind: 'dynamic-tool-map'; file: string; suggestion: 'make-static' | 'add-stable-id' }
  | { kind: 'missing-stable-id'; file: string; symbol?: string }
  | { kind: 'unknown-suite-target'; suiteId: string; targetId: string }
  | { kind: 'model-backed-eval-missing-executor'; suiteId: string }
  | { kind: 'skipped-generated-source'; path: string; reason: string }
```

Use branded ids for stable project-model identities, discriminated unions for provenance and
diagnostics, type guards at config-loading boundaries, and type-level tests for exhaustiveness. Keep
the public interface small: callers should ask for one resolved Project Model and diagnostics, not
manually coordinate source scanning, config loading, quality discovery, and runtime evidence.

## Desired End State

For local tooling, users should be able to have no `crux.config.ts`.

Crux should:

1. scan code;
2. build the Project Index;
3. discover quality suites;
4. infer the authored graph;
5. enrich it with runtime snapshots;
6. show everything in Devtools/TUI/CLI.

If a project needs overrides, it can add a small config:

```ts
export default defineConfig({
  lint: { profile: 'strict' },
  discovery: {
    include: ['apps/web/src/**'],
  },
  cloud: {
    upload: { rawContent: false },
  },
})
```

This is policy and discovery override, not registration.

## Actionable Now

These are concrete near-term items.

### 1. Stop Recommending `config({ prompts, contexts, tools })` For Local Tooling

Docs and examples should lead with source discovery. `config({ prompts })` can remain as a runtime helper or escape hatch, but not the main local tooling path.

### 2. Make Quality Discovery Truly Default

Ensure `crux quality run` can discover:

- `evals/**/*.eval.ts`;
- `**/*.eval.ts`;
- `.crux/quality` baselines and cassettes;
- nearest package name as quality id.

### 3. Add A Resolved Project Model View

Add a CLI/TUI/devtools surface:

```sh
crux config inspect
```

Show:

- selected root;
- discovered packages;
- source roots;
- ignored paths;
- discovered definitions;
- discovered quality suites;
- cassettes and baselines;
- lint profile;
- explicit config file if present;
- inferred vs explicit values;
- diagnostics.

### 4. Add Discovery Diagnostics

Examples:

- dynamic tool map cannot be proven;
- prompt has no stable id;
- suite target is unknown;
- model-backed eval needs explicit executor/model;
- source root skipped as generated/dependency output.

### 5. Deprecate Ambient `quality.setup` In Favor Of Suite-Local Helpers

Keep `setup` for compatibility, but make the new recommended path explicit imports in eval files.

### 6. Move Replay Defaults Toward CLI/Run Tiers

Make `--ci` imply safe replay defaults where appropriate, or document run-tier scripts as the primary way to choose replay posture.

### 7. Auto-Attach Local Devtools Only

If `crux dev` provides a local devtools URL, Crux runtime can attach non-fatally. Production telemetry/cloud export remains explicit.

## Longer-Term Items

### 1. Separate Runtime Setup From Tooling Policy

Consider a future split:

- `config()` or runtime-specific APIs install behavior/plugins.
- `defineConfig()` is inert project policy for CLI/indexer/cloud.

This avoids one API becoming both runtime installer and tooling config.

### 2. Publish A Project Model Contract

Make the resolved Project Index/config model a stable contract so cloud, CI, IDEs, and future adapters consume the same model.

### 3. Adapter-Declared Discovery

Pluggable runtime profiles should be able to declare:

- what definitions they expose;
- what runtime evidence they emit;
- what resources they make inspectable;
- what explicit trust they require.

### 4. Cloud And Training Boundary Policy

Cloud/training config should not duplicate harness registration. It should only control:

- upload eligibility;
- raw content policy;
- redaction/classification;
- retention;
- dataset export eligibility;
- org/team policy.

### 5. Config Drift Review

CI should be able to report when inferred project shape changed:

- newly discovered prompt/context/tool;
- missing quality coverage;
- changed replay/cassette status;
- changed cloud/training eligibility;
- changed explicit policy.

## Product Test

Before adding a config field, ask:

1. Is this relationship already present in authored code?
2. Is this a behavior choice the user must make explicitly?
3. Is this a data movement, trust, privacy, or persistence boundary?
4. Could Crux infer this safely and show a diagnostic when it cannot?
5. Would adding this field create a "forgot to register it" failure mode?

If it repeats authored code, do not add it to config.

If it changes ownership, persistence, privacy, cost, or upload behavior, require explicit user intent.
