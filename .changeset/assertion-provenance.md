---
"@use-crux/core": minor
---

Expose assertion relation provenance reads, complete relation trace evidence, and opt-in graph neighbor evidence support refs. Add a `targets` selector to assertion stages so only selected chunks can become cited evidence while remaining chunks stay visible as context.

Generated assertion stages now send a provider-portable structured-output envelope: evidence chunk refs are schema-generic (validated locally after generation) and `provenance` is required on the wire, so provider structured outputs can run the same derive stages.

Generated assertion stages now compile authored kinds into stable grouped slots with a portable typed profile and slot-local JSON fallback. Decoding revalidates authored schemas, retains valid slots during repair, and reports precise local compatibility failures.

Assertion wire schemas now use a strict portable allowlist, isolate unsupported schemas to JSON-string slots, and target repair attempts at only invalid slots.

Closed required Zod objects, arrays, primitives, and enums now retain typed wire data and authored descriptions, while unconstrained or unsupported schemas continue to use slot-local JSON strings.
