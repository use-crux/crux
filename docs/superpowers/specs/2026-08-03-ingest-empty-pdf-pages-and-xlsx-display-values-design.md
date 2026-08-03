# Empty PDF Pages and XLSX Display Values

## Summary

`@use-crux/ingest` must preserve the physical structure of supported source
documents without misrepresenting spreadsheet evidence. A textless PDF page
must remain addressable even when no media description can be produced, and an
XLSX cell's emitted `value` must reflect its saved Excel number format instead
of the underlying numeric value.

This is a focused correction to the existing PDF and ExcelJS parsers. It does
not add OCR, recalculate formulas, or change the public ingest part shapes.

## PDF Contract

The PDF parser emits exactly one `page` part for every page reported by
`pdfjs-dist`, in source order and with its one-based `pageNumber` and page
`sourceLocation`.

- A page with extracted text keeps the current behavior.
- For a page without extracted text, the parser calls `media.describe` when the
  caller supplied it.
- A non-empty description becomes the page content using the existing visual
  page identity behavior.
- If no describer exists, the describer throws, or it returns empty text, the
  parser emits an ordinary page part with empty content and records a warning
  identifying that page. The warning distinguishes unavailable/empty
  extraction from a failed optional media operation where practical.
- A failed optional description must not discard text already extracted from
  other pages or erase the textless page's physical identity.
- Errors opening the PDF, reading its page tree, or extracting page text remain
  parse failures.

`deriveContent()` already renders an empty page part as `[Page N]`; therefore
the document-level compatibility text continues to account for that page.

The parser does not claim that a textless page is truly blank. Without a media
description, it can only report that no meaningful text was extracted.

## XLSX Contract

ExcelJS remains the workbook parser and source of worksheet ranges, row and
cell coordinates, formula expressions, and cached formula results.

The parser replaces value-only string conversion with one display-value helper
that receives the cell and workbook date-system context:

1. Select the literal cell value or the cached formula result. Formulas are
   never recalculated.
2. Preserve existing textual, rich-text, hyperlink, boolean, error, and empty
   value handling.
3. Render numeric and date values with the cell's saved `numFmt`, using a small
   ECMA-376 spreadsheet-formatting dependency. The implementation should use
   `ssf`, which is small, typed, Apache-2.0 licensed, and supports the workbook's
   1900/1904 date-system option.
4. If a malformed or unsupported format cannot be rendered, retain the previous
   raw-string fallback and emit a cell-addressed parser warning rather than
   failing the workbook.

The resulting displayed string is the single compatibility representation used
by all citation-facing views:

- `IngestTablePart.rows`
- `IngestSpreadsheetRow.cells[].value`
- `IngestTablePart.columns`
- table and sheet `content`

For example, a numeric value `0.2` saved with number format `0%` is emitted as
`20%`, including when it is a cached formula result. The existing `formula`
field continues to carry the expression without a leading equals sign.

Exact Excel viewport rendering is out of scope: column-width overflow,
conditional formatting, themes, and formulas without cached results are not
reconstructed. The contract is the value rendered by the cell's persisted
number format.

## Compatibility and Failure Handling

No public types or exports change. PDF parsing becomes more tolerant for one
case that currently fails the whole document. XLSX strings change only where a
persisted number format gives the source-facing value a different
representation.

Warnings use the existing `IngestWarning` surface and include `partId` or cell
address metadata sufficient to locate the affected source unit. Warning data
must not include document bytes or model/provider payloads.

## Tests

Public ingest tests must cover:

- a PDF containing text, then a textless page, then text, without
  `media.describe`; all three page numbers remain present and the document
  succeeds;
- a textless PDF page with an empty or throwing `media.describe`; the page is
  retained and a warning is exposed;
- the existing successful visual-description path;
- a literal XLSX percentage (`0.2` with `0%`) emitted as `20%` in `rows`,
  `sourceRows`, and rendered content;
- formatted currency and date cells;
- a formatted cached formula result while retaining its formula expression;
- the existing sparse-row, leading-column, range, and coordinate tests.

Focused package tests and typechecking must pass. Relevant broader repository
checks should run in proportion to the dependency and documentation changes.

## Documentation and Release Queue

The ingest reference documentation should say that textless PDF pages are
retained with warnings and can optionally be enriched through
`media.describe`. XLSX documentation should describe `value` as the
number-format-rendered value while formulas and exact source coordinates remain
available separately.

Update the existing `.changeset/xlsx-source-coordinates.md` release entry to
cover both corrections instead of creating a second changeset for the same
ingest release theme.
