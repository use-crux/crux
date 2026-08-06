# Exact structured chunk source spans

## Goal

Ensure `chunker.structured()` never labels guessed or rewritten character coordinates as exact while retaining useful coarse part, page, sheet, table, and source-location provenance.

## Design

Text splitting must retain source offsets while choosing paragraph, sentence, size, and overlap boundaries. Chunk content is sliced from the original part instead of being trimmed and reconstructed. Overlap moves the next slice's start backward in the original text, so each emitted text chunk remains one contiguous source slice.

Part-relative offsets become document-relative only when the complete part content has one unambiguous contiguous occurrence in `document.content`. If the aggregate content is absent, rewritten, or contains multiple indistinguishable occurrences, omit character spans and downgrade confidence to `derived`; never guess with the first `indexOf()` match.

Table windows remain rendered representations. They keep coarse part/page/sheet/table provenance but do not claim the whole table's character span or `exact` confidence for an individual rendered window. JSON and sheet parts retain exact character spans only when their content maps unambiguously.

No public chunk shape changes are required.

## Verification

Cover preserved whitespace, long text splitting, contiguous overlap coordinates, repeated ambiguous content, and table windows. For every exact span, assert `document.content.slice(start, end) === chunk.content`.
