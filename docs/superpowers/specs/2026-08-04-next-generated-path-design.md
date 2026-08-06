# Next generated entry path

## Problem

Crux currently writes its Next.js-facing Runtime entry to
`crux.generated/next.ts`. The dotted directory name is unconventional and does
not match the repository's normal generated-source layout. It also obscures the
intended boundary between Crux's namespace and generated files.

## Decision

Write the Next.js-facing Runtime entry to `crux/generated/next.ts`.

Keep internal Runtime state at `.crux/generated/runtime/`. The resulting split
is:

```text
.crux/generated/runtime/*  # Crux-owned Runtime state and program artifacts
crux/generated/next.ts     # framework-facing generated source
```

This is a clean pre-launch change. Crux will not read, remove, warn about, or
otherwise support `crux.generated/next.ts` after the change.

## Implementation

- Change the Next entry destination and the path used to calculate its relative
  imports.
- Update setup/runtime artifact tests to assert only the new destination.
- Update the Next route documentation to import the new module.
- Replace the root Git ignore entry with the narrow `crux/generated/` path.
- Remove the obsolete `crux.generated` project-watcher exclusion. The existing
  generic `generated` directory rule must continue to exclude
  `crux/generated/next.ts`; the broader `crux` namespace remains visible.
- Update the existing relevant pending changeset because generated CLI output
  and documented application imports are user-visible behavior.

The manifest, privacy snapshot, and shared Runtime program remain under
`.crux/generated/runtime/`. Convex and Cloudflare destinations are unchanged.

## Safety and verification

Generated entry files retain the existing marker-based overwrite protection.
Generation must refuse to replace a user-authored `crux/generated/next.ts`, just
as it does at the old destination today.

Focused verification covers Runtime artifact generation, setup planning, and
the Go watcher filters. Repository typechecking or broader checks run as
appropriate after the focused suite passes.
