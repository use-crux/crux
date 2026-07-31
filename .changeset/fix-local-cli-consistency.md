---
"@use-crux/indexer": patch
"@use-crux/local": minor
---

Make Local CLI lookup and output behavior consistent: accept trace and run IDs, support bare and kind-prefixed Catalog IDs, filter Index kind aliases, align cost reports with observability stats, resolve nested package roots correctly, provide global and Eval JSON output, use Index-specific chrome, and standardize invalid lint options as usage errors.

Restore runtime-discovered Eval execution and timeout facts across bundled Core boundaries, distinguish them from static-only Eval calls, and invalidate pre-fix Local Project Index snapshots.

Make `crux runtime generate` report progress and fail with a bounded timeout instead of hanging silently.

Improve Local CLI error quality and output hygiene: make connection hints command- and port-aware, keep one-shot worker lifecycle logs quiet, explain non-project roots, lead Runtime errors with their actionable diagnostic, validate config/check inputs before work begins, suppress non-interactive spinners and Eval color warnings, and add actionable argument, lookup, import, live-stream, and Stats help guidance.

Make monorepo Eval listing skip test-fixture trees and scope duplicate Eval ids to their owning package, bound offline server connection attempts, distinguish config-import counts from the full Project Index, keep forced-color stderr pipes free of spinner frames, and honor stored-rollup-only observability list reads.
