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
});
```

If `assistantMemory` was constructed with `store`, and a prompt uses `assistantMemory`, that relationship is already authored. If `docs` is used by a prompt, context, or Eval, that relationship is already authored. If an Eval imports a task, that dependency is already authored.

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
- prompts, contexts, tools, agents, flows, compositions, retrieval, memory, workspaces, guardrails, constraints, scorers, and Evals;
- `use[]` relationships;
- prompt/context tree paths where authored through `createPrompts()` / `createContexts()`;
- memory -> store relationships when a memory is constructed with a store;
- retriever/corpus/indexer -> store relationships when constructed in code;
- tool maps and tool-producing contexts where statically visible;
- Eval definitions from `*.eval.ts` and their sibling Baseline files;
- runtime joins from stable IDs and runtime-emitted attributes.

When inference is partial, Crux should emit a diagnostic with a suggested fix. The fix should usually be "make this relationship statically visible" or "add a stable id," not "register it in config."

## What Crux Can Auto-Run Locally

When the user explicitly runs Crux tooling, Crux can safely set up local tooling behavior:

- start the local devtools server;
- run Project Index discovery;
- run source resolver workers;
- run the Eval coordinator;
- use local `.crux/cache`;
- use local `.crux/evals`;
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

## Evals Need No Config Block

Eval discovery is convention-based: one default `evaluate()` export per
`*.eval.ts` file. The production task already owns its prompt, model, settings,
tools, schemas, and Runtime requirements. Cases and Variants live in the Eval;
the CLI controls one invocation with `--offline`, `--fresh`, `--plan`,
`--max-cost`, and selectors. Crux derives evidence reuse automatically.

There is no Eval config block, Eval executor setup, reuse mode, or
registration list. If a required model, host, credential, or durable feedback
destination is missing, collection or preflight fails with the exact action.

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
  | { kind: "source"; file: string; exportName?: string }
  | { kind: "runtime"; traceId?: string; attribute: string }
  | { kind: "filesystem"; path: string; convention: string }
  | { kind: "config"; path: string; key: string }
  | { kind: "cli"; flag: string };
```

Diagnostics should also be a discriminated union with stable reason codes:

```ts
type ProjectModelDiagnostic =
  | {
      kind: "dynamic-tool-map";
      file: string;
      suggestion: "make-static" | "add-stable-id";
    }
  | { kind: "missing-stable-id"; file: string; symbol?: string }
  | { kind: "unknown-eval-coverage-target"; evalId: string; targetId: string }
  | { kind: "eval-host-unavailable"; evalId: string; capabilities: string[] }
  | { kind: "skipped-generated-source"; path: string; reason: string };
```

Use branded ids for stable project-model identities, discriminated unions for provenance and
diagnostics, type guards at config-loading boundaries, and type-level tests for exhaustiveness. Keep
the public interface small: callers should ask for one resolved Project Model and diagnostics, not
manually coordinate source scanning, config loading, Eval discovery, and runtime evidence.

## Desired End State

For local tooling, users should be able to have no `crux.config.ts`.

Crux should:

1. scan code;
2. build the Project Index;
3. discover Evals;
4. infer the authored graph;
5. enrich it with runtime snapshots;
6. show everything in Devtools/TUI/CLI.

If a project needs overrides, it can add a small config:

```ts
export default defineConfig({
  lint: { profile: "strict" },
  discovery: {
    include: ["apps/web/src/**"],
  },
  cloud: {
    upload: { rawContent: false },
  },
});
```

This is policy and discovery override, not registration.

## Actionable Now

These are concrete near-term items.

### 1. Stop Recommending `config({ prompts, contexts, tools })` For Local Tooling

Docs and examples should lead with source discovery. `config({ prompts })` can remain as a runtime helper or escape hatch, but not the main local tooling path.

### 2. Keep Eval Discovery Truly Default

Ensure `crux eval` can discover:

- `evals/**/*.eval.ts`;
- `**/*.eval.ts`;
- sibling `.baseline.json` files;
- private `.crux/evals` run and evidence records without treating them as source.

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
- discovered Evals and their Baseline readiness;
- lint profile;
- explicit config file if present;
- inferred vs explicit values;
- diagnostics.

### 4. Add Discovery Diagnostics

Examples:

- dynamic tool map cannot be proven;
- prompt has no stable id;
- Eval coverage target is unknown;
- a task requires a Runtime host that cannot be resolved;
- source root skipped as generated/dependency output.

### 5. Auto-Attach Local Devtools Only

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
- missing Eval coverage;
- changed Eval or Baseline compatibility;
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
