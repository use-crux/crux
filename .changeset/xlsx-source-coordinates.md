---
"@use-crux/ingest": minor
---

Expose provider-neutral XLSX row, cell, formula, and exact worksheet/row-range
source coordinates alongside the `rows` compatibility view, including sparse
blank cell slots aligned with source accounting ranges. Render citation-facing
XLSX cell values through their saved number formats instead of exposing raw
numeric storage values.
XLSX display projection now also preserves rich text, hyperlink display text,
Excel error tokens, cached formula results including shared formulas, and merge
membership metadata. Merge followers retain their coordinates with empty values
and no formula while the master cell owns the displayed value/formula.

Keep every physical PDF page in ingest output. Textless pages now produce a
located warning and remain addressable when media description is unavailable,
empty, or fails, rather than failing the whole document.
XLSX malformed number-format warnings now include the sheet name, and failed PDF
media descriptions include the underlying error text in the warning message.
Load the XLSX number formatter correctly from published ESM packages so saved
formats remain active outside the Crux source workspace.
