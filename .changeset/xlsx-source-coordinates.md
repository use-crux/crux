---
"@use-crux/core": minor
"@use-crux/ingest": minor
---

Replace legacy ingest provenance with the public schema-2 `IngestedDocument`
and immutable `StoredEvidence` contracts. Core now retains validated document,
producer, block, coordinate, and normalized-content evidence through chunking,
storage, and retrieval; legacy aggregate-text spans are not schema-2 source
truth.

Built-in CSV, DOCX, XLSX, and PDF parsing now emits schema-2 evidence. Custom
parsers selected through `ParserOptions.parsers` must implement
`parser.schema2.parse()` and return a valid schema-2 document; legacy custom
`parse()` results are rejected.

XLSX evidence preserves exact sheet ranges and cells, saved display formats,
rich text, hyperlinks, error tokens, cached/shared formulas, and merge
ownership. CSV retains exact logical rows, DOCX retains document structure and
inline/list text, and PDF retains every physical page, layout blocks/tables
when available, and bounded downgrade diagnostics.

Core's package test command now isolates test files in Node subprocesses to
avoid cross-test filesystem and process-state leakage.
