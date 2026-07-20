# Runtime generation and Eval DX

## Problem

`crux runtime generate` currently discovers every authored Eval and projects
every task through the adapter-managed task descriptor protocol. Ordinary
callable Eval tasks are valid in the public Eval API and already execute through
the local coordinator, but generation rejects them with an internal error that
does not name the Eval, its source, or a useful remedy.

This is a Crux placement bug, not a user setup mistake. A valid project must not
become undeployable because it contains local deterministic Evals, and users
must not have to understand Crux's internal task representation to recover.

The surrounding command lifecycle also needs one coherent contract:

- `crux setup` inspects project wiring;
- `crux setup --apply` safely creates missing wiring and generated files;
- `crux dev` keeps derived files fresh automatically;
- framework build integrations generate before building; and
- `crux runtime generate` is the explicit one-shot equivalent for CI, recovery,
  and advanced use, not a routine development step.

## Product principles

1. Ordinary functions and adapter-managed AI tasks are both valid Eval tasks.
2. Users author Evals; Crux derives execution placement for each Current or
   Variant arm.
3. Normal setup, development, and framework builds keep generated files current
   without a memorized manual command.
4. A problem names the affected feature and source, explains why it matters,
   states what remains available, and suggests action only when user action can
   help.
5. Internal terms such as “managed descriptor,” “opaque task,” and “deployment
   disposition” do not appear in ordinary CLI output.
6. Generation validates the complete output plan before modifying any generated
   file.

## User-visible contract

Both of these remain valid without flags or annotations:

```ts
evaluate({ task: deterministicFunction, cases })
evaluate({ task: generate.task(prompt, options), cases })
```

`crux eval` discovers and runs both. Runtime generation succeeds in a project
containing either or both. Crux does not add `deploy`, `localOnly`, `managed`, or
similar placement options to the authoring API.

An ordinary callable runs in the coordinator. An adapter-managed task runs in
the coordinator when it has no durable-host requirements and in the configured
Runtime host when it declares capabilities that require that host. This is an
internal derived decision, not a user classification.

Zero host-executed Evals is a successful and silent condition.

## Command roles and automatic freshness

### `crux setup`

The command is read-only. It reports missing or conflicting project and host
wiring. It may report generated artifacts as absent or stale, but it does not
write them.

### `crux setup --apply`

The command performs safe additive setup, reinspects the resulting project, and
then generates Runtime artifacts if no blocking setup finding remains. A fresh
project that Crux can configure safely finishes with its generated files
current. It never overwrites a user-authored entry, changes ambiguous routing,
provisions paid infrastructure, or writes credentials.

### `crux dev`

The command binds the local listener and renders the workbench first. Initial
Runtime generation then runs in the existing asynchronous startup lifecycle.
Relevant source edits trigger coalesced regeneration. A failure is retained in
the startup journal and retried after the next relevant edit; it does not stop
the listener or erase the TUI.

### Builds and the one-shot command

Framework integrations generate before compiling or deploying. The existing
`withCruxBuild()` behavior continues to do so for Next.js. Generated Convex
entry files remain normal generated project files consumed by the Convex
workflow.

An existing user-owned `convex/http.ts` remains compatible when its exported
router already calls `crux.bridge(http, cruxConfig)`: the bridge registers the
authenticated Runtime Eval routes and generation preserves that router
byte-for-byte. Crux recognizes the actual call syntax rather than matching
comments or strings. Other user-owned routers remain protected from overwrite
and receive an explicit composition remedy.

`crux runtime generate` deterministically performs that generation once. It is
appropriate for CI, build integrations, recovery, and inspection. It is not a
prerequisite before every `crux dev` run.

There is no `crux init`; documentation consistently calls project wiring
`setup`.

## Arm-level execution placement

Placement is derived separately for every effective Eval arm: Current and each
Variant. The shared projection returns one of:

- `coordinator`, with no durable-host capabilities, for an ordinary callable;
- `coordinator`, with no durable-host capabilities, for a compatible
  adapter-managed task that needs no durable host;
- `runtime`, with a normalized non-empty capability set, for a compatible task
  that needs a deployed Runtime host;
- an authored-code finding for a non-callable task value; or
- a version/configuration finding when an installed adapter exposes an
  incompatible task contract.

The Project Indexer, planner, artifact generator, generated registry, and host
admission consume this same projection. They must not independently infer
placement.

An Eval is included in a deployed registry only when at least one arm has
`runtime` placement. Within that Eval, the generated registry allowlists only
the runtime arms. Resolving a coordinator arm through the deployed registry is
rejected as an unavailable arm; it cannot accidentally be sent to the host.
Host admission checks the selected arm's capabilities rather than an Eval-wide
union.

The Eval-wide normalized union remains in compatibility-facing metadata as a
summary, but it is derived only from runtime arms and is never used to decide
the selected arm's admission.

This excludes modules that contain only coordinator Evals from generated host
entry graphs. A mixed module containing both coordinator and runtime arms must
still be imported to expose its runtime arm, so Crux cannot promise to erase
that module's top-level dependencies. Crux-owned discovery or generation import
failures name the indexed Eval and source module and, when resolution reached an
arm, its arm. A downstream Convex, Next, or Cloudflare compiler remains the
authority for host-specific module portability and may emit its native import
diagnostic; this work does not claim a generic host compiler preflight. Users do
not need a placement flag to fix unrelated local-only Eval modules.

## Project Index contract and cache migration

Runtime-rich Eval facts gain deterministic arm metadata:

```ts
type EvalExecutionArmFact =
  | {
      name: "current" | string;
      execution: "coordinator" | "runtime";
      requiredHostCapabilities: string[];
    }
  | {
      name: "current" | string;
      status: "invalid";
      code:
        | "task_not_callable"
        | "task_contract_incompatible"
        | "variant_invalid";
      reason: string;
    };
```

Every discovered Eval exposes all authored arms in
`metadata.evalExecutionArms`, sorted with `current` first and Variants by name.
Valid arms carry placement and normalized, sorted capability arrays. Invalid
arms retain their typed failure and reason so a downstream generator cannot
mistake a missing arm for a coordinator-only Eval and fail open. Existing
`metadata.requiredHostCapabilities` remains as the sorted union of runtime-arm
requirements for compatible readers.

This is a Project Index output change for unchanged source. Implementation must
bump `ProjectIndexSnapshotCacheEpoch` in the Go snapshot cache and include a
restart regression proving an old base-task-only snapshot is missed and
reindexed automatically. Users must not be told to delete `.crux/cache`.

The static parse and semantic facts epochs change only if implementation alters
their persisted projections. If either backend participates in the new fact,
the JavaScript and native semantic parity fixtures must prove identical
normalized output and the corresponding epoch or compiler identity must be
updated. The implementation review must explicitly record why each identity
was or was not changed.

## Generated artifact and host contracts

Three contracts remain deliberately separate:

1. the local `.crux` Runtime artifact manifest moves to schema version 2;
2. the generated deployed registry gains arm-level requirements; and
3. the authenticated host wire remains byte-compatible
   `crux.eval-host.v1`.

The local artifact manifest v2 records every arm's identity and placement. Each
arm includes its fingerprint, execution location, and normalized required
capabilities. Only Evals with at least one runtime arm receive a deployed entry,
and that entry retains the runtime-arm capability union as a compatibility
summary.

The generated registry receives two distinct projections: all arm fingerprints
as identity evidence and an exact runtime-arm execution allowlist with per-arm
requirements. It does not reconstruct eligibility by importing an Eval and
accepting all of its Variants. Registry resolution rejects an arm absent from
the execution allowlist. Host invocation checks the selected registry arm's
requirements against the host adapter's capabilities before execution.

The authenticated host manifest does **not** gain a per-arm field. It preserves
the exact v1 top-level and Eval-entry keys. For each included Eval, `variants`
remains a string fingerprint record containing **all** arms as identity
evidence, including coordinator arms, while `requiredHostCapabilities` carries
the conservative runtime-arm union. Identity advertisement is not execution
permission: only the registry's separate runtime-arm allowlist can resolve a
request. The new coordinator uses its own Project Index arm facts plus the
manifest's global `capabilities` for exact selected-arm readiness; the Eval-wide
union remains the conservative check for v1 readers.

Local discovery and `crux eval` continue to use the full Project Index, so a
coordinator arm's absence from the deployed registry never removes it from the
user's Eval catalog.

### Compatibility window

The authored TypeScript API remains compatible, but this is an observable
generated-artifact schema migration rather than a purely additive internal
change.

- New code reads local artifact manifest v2 exactly. An unsupported local
  artifact version is regenerated by commands that own generation or produces a
  versioned regeneration remedy in read-only contexts.
- The authenticated wire stays v1 and continues to satisfy the current exact
  decoder; no protocol negotiation is introduced.
- A new coordinator with a last-good host uses its own arm facts for placement
  and the host's global capabilities for exact selected-arm readiness. The old
  host's Eval-wide requirement union remains a safe conservative check.
- A newly generated host preserves all arm fingerprints in the v1 `variants`
  identity record and the Eval-wide union, so an old coordinator whose own task
  projection supports that Eval passes its existing exact readiness comparison.
  The registry still rejects coordinator arms at execution admission.
- Old coordinators never supported an Eval containing an ordinary callable arm;
  those clients must upgrade to gain this feature. They receive no promise of
  functional mixed-callable compatibility merely because they can decode the
  v1 wire.
- Exact byte-shape fixtures cover both directions, an old `compareManifest`
  readiness fixture covers a supported all-adapter mixed Eval, and decoder tests
  prove unknown host-wire fields are still rejected.

Generated artifacts are expected to be regenerated and deployed together;
compatibility prevents confusing failure during the transition, not indefinite
support for every old generated registry.

## Artifact pipeline and write safety

Generation has two explicit phases.

### Plan and validate

1. Acquire a fresh runtime-rich Project Index snapshot.
2. Discover Runtime targets and import Eval modules.
3. Resolve every effective Eval arm and derive placement with Eval ID, arm name,
   and source context.
4. Exclude Evals whose arms are all coordinator-executed before reading,
   hydrating, fingerprinting, or validating their Cases for deployment.
5. Hydrate and validate deployable Cases only for Evals with at least one
   runtime arm.
6. Compare the derived facts with the Project Index and report disagreement as
   an internal consistency failure.
7. Construct registry and manifest data from runtime arms only.
8. Render every canonical destination into an in-memory `RuntimeArtifactPlan`.
9. Read and validate every destination's ownership, readability, path safety,
   and protected-file policy before the first write.

A protected conflict discovered at any destination leaves every generated file
byte-for-byte unchanged. A regression test places the conflict at the last
destination to prove validation is complete before commit.

### Commit

Only a fully valid plan enters commit. Changed contents are staged in sibling
temporary files and renamed atomically per destination. The activation manifest
is written last. An unexpected I/O failure is classified as an internal or
environmental failure, reports which files were activated, and attempts to
restore the last-good contents; an operating-system crash cannot be promised as
a multi-file atomic transaction.

Canonical unchanged files are not rewritten. The one-shot command and watcher
produce byte-identical output from the same snapshot.

## Setup orchestration

Setup inspection treats a host-bound Runtime declaration as configuration
metadata. It must not execute that declaration outside its host, so a valid
Convex declaration cannot produce `RUNTIME_HOST_ONLY` merely because setup is
inspecting it.

`crux setup --apply` follows this gate:

1. inspect and plan safe actions;
2. apply safe actions;
3. re-inspect and discard superseded pre-apply findings;
4. if any final `error` finding remains, skip generation and leave generated
   files unchanged;
5. otherwise acquire a fresh runtime-rich snapshot and run the same plan,
   validation, and commit pipeline as the one-shot command.

Warnings and informational findings do not block generation. Generation
failures become `runtime-artifacts` setup findings and make the final setup
result unsuccessful.

The provider-neutral `SetupReport` in `@use-crux/core` remains unchanged. The
CLI/indexer boundary owns this exact JSON envelope:

```ts
type SetupCommandResult = {
  ok: boolean;
  setup: SetupReport;
  generation: {
    status:
      | "current"
      | "would-generate"
      | "generated"
      | "blocked"
      | "failed";
    contentHash?: string;
    pendingFiles: string[];
    changedFiles: string[];
    findings: RuntimeArtifactFinding[];
  };
};
```

All file paths are project-root-relative POSIX paths. `pendingFiles` lists the
valid dry-run plan when status is `would-generate`; `changedFiles` lists writes
completed when status is `generated`; otherwise each is empty unless a valid
plan exists before an environmental commit failure. `contentHash` is present
whenever a complete valid plan exists.

For check mode, `ok` is true only for `current`; `would-generate`, `blocked`, and
`failed` are false. For apply mode, `current` and `generated` are true;
`blocked` and `failed` are false. Check mode never returns `generated`, and
apply mode never returns `would-generate`.

A stale check adds one synthesized `runtime-artifacts` setup finding with code
`RUNTIME_ARTIFACTS_STALE` and a `crux setup --apply` remedy. A generation
failure adds one aggregate `runtime-artifacts` setup finding; it does not copy
each child into `setup.findings`. The complete children live only in
`generation.findings`. A setup blocker produces status `blocked`, no generation
finding, and preserves the original setup findings that caused the gate.

Human output renders the final setup findings followed by the generation
outcome. It never reports a stale pre-apply error after that error was safely
fixed.

`crux setup` without `--apply` performs the planning and conflict checks in
dry-run form and reports whether generation would be blocked, but makes no
writes.

## Diagnostics

Generation returns an aggregate result with a deterministically sorted
`findings` array. Each finding contains:

```ts
type RuntimeArtifactFinding = {
  code: string;
  category: "authored" | "configuration" | "environment" | "internal";
  featureKind?: "eval" | "runtime" | "target" | "generated-file";
  featureId?: string;
  arm?: string;
  source?: string;
  summary: string;
  reason: string;
  whatStillWorks?: string;
  remediation?: string;
  docs?: string;
};
```

`remediation` is optional. It is present only when a concrete user action can
help. Internal failures say that Crux could not complete the operation, include
a stable code and context, and do not invent a user mistake or setup ritual.

The worker protocol transports the aggregate error and all child findings.
The startup journal retains one lifecycle diagnostic for the failed generation
attempt with the full child array. The TUI shows its first useful summary and
count, with all details available in the diagnostic view. JSON output preserves
every finding. Human command output renders at most five findings followed by a
“and N more” line.

Findings sort by source, feature ID, arm, and code, independent of import or
worker completion order. Watcher remediation describes the underlying action
and automatic retry; it never merely tells users to rerun the generator that is
already running.

No warning is emitted merely because an Eval is coordinator-executed, no Eval
requires a host, or generated files are already current.

## Delivery phases

This work is implemented and reviewed in three ordered slices so correctness is
demonstrable before setup expands the surface area.

### A. Placement and artifact schema

- shared arm-level projection;
- Project Index arm facts and cache migration;
- local manifest v2, runtime-arm registry allowlisting, and exact-arm admission;
- byte-compatible host-wire v1 and local-artifact v2 fixtures;
- ordinary-only, managed-only, mixed-arm, backend parity, and host-bundle tests.

### B. Generation reliability and diagnostics

- complete in-memory artifact plan and destination preflight;
- protected-last-destination regression;
- aggregate structured finding protocol through TypeScript, Go, startup
  journal, plain output, JSON, and TUI;
- deterministic multi-error and watcher recovery tests.

### C. Setup and lifecycle integration

- metadata-only host inspection;
- final-state reinspection and generation gate;
- combined setup JSON/human output;
- initial dev generation and watcher parity;
- docs that explain setup/dev/build/one-shot roles without internal jargon.

Each slice receives focused tests and code review before the next begins. The
feature is considered complete only after all three slices and the mixed
regression project pass.

## Required regression coverage

### Placement and portability

- ordinary-only projects generate successfully and produce no deployed Eval
  registry entries;
- mixed projects deploy only runtime arms while all coordinator arms remain
  discoverable and runnable locally;
- `current` and Variant arms may choose different placement and capability sets;
- selecting a coordinator arm through the host registry is rejected;
- a coordinator-only Eval with locally valid but non-host-serializable Cases
  generates successfully without reading or validating those Cases for
  deployment;
- modules containing only Node-specific coordinator fixtures are absent from
  Convex and Next host entry graphs;
- a Crux-owned mixed-module import failure includes indexed Eval and source
  context, while host-compiler portability failures preserve the host compiler's
  native diagnostic;
- Project Index, planner, generator, registry, and host admission fixtures prove
  exact normalized parity.

### Cache and compatibility

- restart with a pre-change Project Index snapshot forces reindexing;
- no manual cache deletion is needed;
- the exact v1 host wire decodes for both new-coordinator/last-good-host and
  old-reader/new-host fixtures, with no added keys;
- local artifact manifest v2 rejects unsupported versions as specified;
- stale or unsupported artifacts fail with a versioned regeneration remedy.

### Generation and diagnostics

- a final-destination protected conflict changes no file;
- multiple failures remain stable under randomized completion order;
- authored, configuration, environment, and internal failures use the correct
  optional-remediation behavior;
- human output contains no descriptor/opaque/placement jargon;
- JSON and worker transport retain every child finding;
- one watcher lifecycle diagnostic contains all findings and recovers after the
  next valid edit.

### Setup and lifecycle

- `crux setup --apply` on a valid fresh project leaves artifacts current;
- a remaining blocking setup finding prevents all generation writes;
- successful safe application does not retain obsolete pre-apply findings;
- `crux dev` generates asynchronously and coalesces relevant edits without
  publishing an obsolete snapshot;
- one-shot and watcher output is byte-identical.

### Representative project

A fixture with 39 ordinary callable Evals and four adapter-managed Evals passes
`crux runtime generate`, `crux setup --apply`, initial dev warmup, and watched
regeneration without changing those Eval definitions or adding placement flags.

## Release

This adds public behavior and migrates a pre-1.0 generated artifact schema. It
is intentionally a **minor**, never major, Changesets bump. The existing
release-theme changeset should be updated instead of creating a duplicate.

No Eval evidence, scorer, Baseline, or judge cache identity changes are expected.
If implementation changes those semantics, it must stop for separate design
review rather than silently broadening this work.

## Out of scope

- provisioning paid or destructive host infrastructure;
- making every top-level dependency in a mixed module portable to every host;
- user-authored placement flags;
- renaming `crux setup` or introducing `crux init`;
- changing Eval evidence identity, scoring, Baselines, or judge semantics.
