---
"@use-crux/ai": minor
"@use-crux/core": minor
"@use-crux/convex": minor
"@use-crux/devtools": minor
"@use-crux/openai": minor
"@use-crux/postgres": patch
"@use-crux/anthropic": minor
"@use-crux/google": minor
"@use-crux/ingest": patch
"@use-crux/indexer": minor
"@use-crux/next": minor
"@use-crux/cloudflare": minor
"@use-crux/vercel": minor
"@use-crux/otel": minor
"@use-crux/local": minor
"@use-crux/react": patch
"@use-crux/upstash": patch
---

Make portable application entrypoints verifiable in both source and staged npm
packages, remove package-wide Node engine restrictions where the primary graph
is portable, and include the Next integration in TypeScript release staging.

The `@use-crux/ai` root no longer downloads HTTPS transcription input
implicitly. Portable callers must provide materialized audio; Node callers can
import `transcribe` or `createAiSdkTranscribe` from the new
`@use-crux/ai/transcription/node` subpath to retain the bounded, DNS-pinned
download behavior. Portable data-URL transcription no longer relies on the
Node `Buffer` global.

Unify observability and host-lifecycle async scoping on Core's canonical
carrier so no-AsyncLocalStorage runtimes retain synchronous fallback behavior
while unsafe asynchronous ambient host scopes fail closed.

Add portable deployment identity and privacy-safe Project Index manifest
contracts to Core. The build-time Indexer now projects and verifies the same
deterministic artifact internally.

Carry immutable deployment identity through v3 observability graph records,
suspend/resume propagation, and local run detail while retaining persisted v2
reads as deployment-unspecified. `@use-crux/otel` now exports a portable
Resource-attribute mapper, maps lightweight identity per span, and projects
DefinitionRefs through bounded attributes and events.

Add daemon-free `crux check` with deterministic JSON and explicit CI exit
codes. `crux lint` now uses the same one-shot Project Index service and embedded
worker pipeline by default while retaining its no-gate compatibility behavior
and an explicit `--server` path.

Add daemon-free `crux manifest` artifact generation and verified, idempotent
`crux catalog import`. Local observability now resolves runtime definition
references only against the exact immutable deployment manifest named by a run
and labels current-checkout comparisons separately.
Definition fingerprints now use normalized project-relative source identity so
identical checkouts produce the same manifest ID; static, semantic, and Go
snapshot cache epochs invalidate root-dependent historical fingerprints.

Add deterministic `crux catalog` list, show, status, and explain projections
with compiler provenance, safe source paths, Health/Eval/runtime joins, and
truthful partial or unknown state. The beta `crux index` list/show paths now
delegate to Catalog while category keywords and explicit reindex remain.
Durable definition evidence now retains canonical extractor and resolved
extension provenance, and Catalog explanations name every actual contributor
without changing the public evidence shape or phase producer identity.
Durable relation, source-reference, and diagnostic evidence now retains the
same exact extractor contributors across worker, cache, and restart boundaries.

Add opinionated `withCrux` lifecycle boundaries for Cloudflare Workers and
Next.js while retaining their low-level adapters. Workers and Next now compose
deferred work with contained, bounded post-response observability drains;
`createCruxConvex().run()` owns the corresponding bounded terminal drain and
preserves deployment identity across durable continuation boundaries.
Rejected promises returned by advisory drain reporters are contained without
delaying or replacing handler results or host-owned drain work.
Rename the Next Runtime artifact build plugin to `withCruxBuild`, reserving
`withCrux` for framework lifecycle boundaries without a compatibility alias.
Add explicit `config({ host })` retention bindings for Node, Next.js,
Cloudflare Workers, and Vercel. Config-only ambient defer uses an ephemeral
invocation per call; failed or cancelled scopes now record and skip inline
callbacks instead of running them.
Remove defer completion classes and lifetime factories in favor of the scope
kernel's host bindings. Serverless and Node wrappers now enqueue retained work
through the root gate. Move the Workers `withCrux` lifecycle boundary from
Core's deleted `/observability/workers` subpath to `@use-crux/cloudflare`,
where its structured drain runs before the kernel flush.
Open lazy execution scopes at Crux agent, adapter, tool, Safety, flow-step, and
Convex bridge boundaries. Inline `defer()` now works with zero host setup inside
defer-capable primitives on long-lived processes; nested work drains at its
nearest boundary and streaming adapters restore one scope across Core-owned
iteration and completion segments.
Configured host retention now applies uniformly when any Crux primitive is the
execution root. Primitive drains still start immediately, while retention-port
failures propagate after deterministic sealing instead of silently accepting
work the host cannot keep alive.
Run Evals and their cells as execution scopes. Deferred work registered by an
Eval task is captured as cell evidence instead of invoking inline callbacks or
staging named Runtime work, and expired remote cells drop late observability
writes through the shared scope-sealing policy.
Teach setup diagnostics, the built-in defer lint, and public documentation the
same primitive-first host-retention ladder, including exact Next, Vercel, and
Workers remediations and the generic serverless adapter contract.
Remove the config-dependent `defer.missing_scope` bundled lint; `crux setup`
now owns host-retention diagnostics using selected config and platform evidence.
Portable MCP entrypoints now fail closed when stdio is selected, while Node
runtimes resolve their lazy stdio adapters through private conditional imports.

Align public documentation around Catalog, Runs, Evals, and Health. Narrow
the published Indexer root to Crux-owned compiler contracts; third-party
authoring stays on the experimental `/extensions` subpath and is declarative,
limited to extractors plus relation declarations.

Correlate successful managed operation results with the exact Core-owned W3C
trace and producing span. Generation hooks and middleware receive finalized
results; stream handles expose identity immediately and repeat it on
completion; completed media, agent/composition, flow, scoring, compaction,
citation, and content-indexing summary envelopes follow the same exact-owner
contract while provider payloads and raw values remain ID-free.
Completed-operation bindings now use the documented exact media-operation
vocabulary; formerly normalized spellings such as `generate-image` or
`generateimage` no longer imply a Core-owned media span.

Managed AI Eval tasks retain correlated response metadata after removing raw
provider values. Eval cells continue to store logical task `runIds`, while
assertion outcomes store exact related span IDs; neither is relabelled as a W3C
trace ID. Semantic-cache and flow persistence boundaries prevent
invocation-local IDs from leaking across replay or durable execution. The
private deployed-Eval result wire advances to schema version 2 so retained task
responses require the same correlation contract across hosts.

Postgres Runtime snapshot decoding now revives nested suspend deadlines, and
terminal retention recognizes expired flow snapshots.
