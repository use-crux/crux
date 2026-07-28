---
"@use-crux/core": minor
"@use-crux/local": minor
---

Add deployment-wide observability redaction patterns for organization-specific
identifiers. Patterns redact captured payload values before evidence derivation
and final telemetry fan-out without changing application, model, or tool data.
Project Index reports only the privacy-safe configured state, while Local and
Devtools surface successful-redaction evidence using broad telemetry surfaces
without exposing rules, values, replacements, paths, hashes, or counts.
