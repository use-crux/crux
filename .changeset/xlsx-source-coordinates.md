---
"@use-crux/ingest": minor
---

Expose provider-neutral XLSX row, cell, formula, and exact worksheet/row-range
source coordinates alongside the `rows` compatibility view, including sparse
blank cell slots aligned with source accounting ranges. Render citation-facing
XLSX cell values through their saved number formats instead of exposing raw
numeric storage values.

Keep every physical PDF page in ingest output. Textless pages now produce a
located warning and remain addressable when media description is unavailable,
empty, or fails, rather than failing the whole document.
