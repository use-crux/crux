# XLSX Structured Values and Merged Cells

## Summary

`@use-crux/ingest` must emit meaningful, citation-safe strings for every
persisted ExcelJS cell-value shape it supports. It must never turn a valid XLSX
cell into the literal string `[object Object]`.

The fix also makes merged-cell ownership explicit. ExcelJS exposes a merged
follower through its master's value, which currently makes the same content
appear to belong independently to several cell addresses. Crux will retain the
merge topology while assigning the displayed value only to the master cell.

This design extends the existing XLSX coordinate and display-value contract. It
does not recalculate formulas, retain rich-text styling, or attempt pixel-level
Excel rendering.

## Considered Approaches

1. **Use `cell.text`.** Rejected because cached formula errors still stringify
   poorly, saved number formats would be bypassed, and merged followers remain
   ambiguous.
2. **Add rich-text and error branches only.** This removes the immediate marker
   but leaves valid shapes vulnerable to future fallthrough and repeats merged
   values across false coordinates.
3. **Exhaustive value projection plus explicit merge provenance.** Chosen. It
   keeps the string compatibility view, handles the closed ExcelJS value union,
   and gives citation-aware consumers enough structure to interpret merges.

## Display-Value Contract

One internal renderer projects the literal cell value or cached formula result
to visible text:

- `null` and `undefined` become an empty string;
- strings, numbers, and booleans retain their ordinary textual form;
- dates retain the existing ISO fallback and saved-number-format rendering;
- rich text concatenates its ordered `richText[].text` runs and discards style;
- hyperlinks emit their display `text`;
- Excel error values emit their exact token, such as `#N/A` or `#DIV/0!`;
- formula and shared-formula values render their cached `result` recursively,
  while the existing `formula` field retains the expression;
- numeric and date display values continue through SSF when `numFmt` exists.

The renderer must not use `String(value)` for an object. An unknown or malformed
object produces an address-located parser warning and an empty compatibility
value rather than poisoning downstream prompts and search documents.

The resulting string remains identical across `rows`, `sourceRows[].cells`,
`columns`, table content, and sheet content.

## Merged-Cell Contract

Add a provider-neutral optional merge descriptor to spreadsheet cells:

```ts
interface IngestSpreadsheetMerge {
  master: string;
  sourceRange: IngestSpreadsheetRange;
}

interface IngestSpreadsheetCell {
  // existing fields
  merge?: IngestSpreadsheetMerge;
}
```

Every cell participating in a merge carries the same descriptor. The cell whose
`address` equals `merge.master` owns the displayed value and any formula. Merged
followers retain their physical addresses but emit an empty `value` and no
formula. Consumers can distinguish a genuinely blank cell from a merged
follower and can recover the master's exact range without relying on ExcelJS.

Merge ranges come from the public worksheet model. They are validated and
normalized into the existing one-based `IngestSpreadsheetRange` shape.

This contract deliberately avoids copying master text into follower cells.
Applications that need row-local context for a vertically merged region can
look up the master through `merge.master`; any repeated context then remains an
explicit presentation choice rather than false source ownership.

## Warnings and Failure Handling

Valid ExcelJS shapes do not warn. Unknown or malformed structured values emit a
`parser_warning` containing the sheet name, cell address, and safe structural
identity needed for diagnosis. Warnings must not contain workbook bytes or the
full rejected cell payload.

A malformed individual value does not fail the workbook. Workbook/container
parse failures retain existing behavior.

## Tests

Round-trip XLSX tests must cover:

- rich text in `rows`, `sourceRows`, table content, and sheet content;
- hyperlink display text;
- literal Excel errors and cached formula errors;
- cached formula results `0` and `false`;
- formulas retained alongside their displayed result;
- horizontally and vertically merged rich-text cells, including one master
  value, empty followers, and exact merge descriptors;
- unknown structured values through a focused unit seam, asserting a located
  warning and no `[object Object]` output;
- existing percentages, currencies, dates, sparse rows, and source coordinates.

The package test suite, package typecheck, and `git diff --check` must pass.

## Documentation and Release Queue

Update the Ingest public type/reference documentation with the structured-value
and merge semantics. Update the existing
`.changeset/xlsx-source-coordinates.md`; do not add a second XLSX changeset.

