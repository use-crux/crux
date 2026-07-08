---
'@use-crux/core': minor
'@use-crux/local': minor
'@use-crux/devtools': patch
---

Stabilize the Quality beta API and experiment record contract: `ctx.score()` becomes `ctx.recordScore()`, post-score callbacks are now `afterScores`, retrieval recipe targets use `target.retrievalRecipe()`, decision-report assertions use the singular `decisionReport` namespace, and experiment records now write schema-version 2 `cells` with ordered assertion `outcomes` only.

Harden Quality determinism by adding explicit cache identity epochs, including structured-output schemas and tool parameter schemas in cassette keys, including case input, prompt, params, dataset content, and scorer identity in output-cache/baseline fingerprints, failing loudly on corrupt committed baselines, and rejecting invalid scorer values instead of aggregating them.

Make Quality artifact writes atomic and safer under concurrent runs: cassette recording now single-flights duplicate misses, flushes merge with on-disk entries under a lock, timed-out cells quarantine late trace/cassette writes, and local read-model records write via temp-file rename.

Harden judge-backed scoring by pinning judge generation settings, framing untrusted output/reference/context in judge prompts, stamping judge provenance on score metadata and baseline identity, and adding human-label plus judge-report tooling for judge-vs-human agreement.

Harden the Quality local pipeline by making `crux quality run --json` emit a single run summary object, adding worker/core protocol version checks and run-scoped event ids, surfacing worker crashes as structured exit-2 failures, fixing live read-model collisions and source-frame path containment, reporting skipped legacy records, and requiring an explicit devtools promotion variant.

Add the Quality machine contract surface: `@use-crux/core/quality/schemas` exports validation schemas and JSON Schema generation for records and CLI JSON, experiment records embed agent-readable `failures` artifacts, and `crux quality diff <expA> <expB> --json` compares saved experiment records through core-owned diff policy.

Add the Quality adoption path: `crux quality init` scaffolds first evals for uncovered prompt definitions, `crux quality import-traces` converts retained local traces into JSONL dataset rows, and dataset-backed failures now surface dataset path plus content fingerprint in persisted records, run summaries, failure artifacts, and experiment diffs.

Add the Quality agent loop: `crux quality run` now supports `--failed`, deterministic `--sample`/`--seed`, `--max-cost`, and `--changed-since` subsets, `crux quality mcp` exposes list/run/show/diff/evidence/judge-report/label tools over MCP, and `crux quality init` scaffolds a local Quality skill for coding agents.

Declare Quality beta: the authoring surface, experiment/manifest schemas, CLI JSON outputs, and exit codes are stable within 0.x minors; future breaking changes require a minor bump and migration note while the first-party runner facade remains internal.
