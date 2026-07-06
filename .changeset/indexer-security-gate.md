---
"@use-crux/indexer": patch
"@use-crux/local": patch
---

Harden indexer untrusted-input handling: source-only static syntax planning no longer imports project config, extension loading verifies resolved package identity and containment before import, and source-map disk reads are contained to the project root.

Preserve semantic source-profile completeness across worker streams so incomplete profiles are not reused through the semantic facts cache, and split Project Index worker transport limits so multi-line fact/artifact streams can exceed the per-line cap without failing.

Harden Project Index correctness and determinism across patch merging, native/static syntax parity, record-lane extraction, stale provided-record handling, extension diagnostics, and rejected cache reads so cached, incremental, and native-backed runs preserve the same read-model facts.
