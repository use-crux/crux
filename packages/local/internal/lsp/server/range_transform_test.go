package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestApplyDocumentChangesMovesDiagnosticAfterInsertedLines(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	diagnostics := []protocol.Diagnostic{{
		Range: protocol.Range{
			Start: protocol.Position{Line: 4, Character: 2},
			End:   protocol.Position{Line: 4, Character: 6},
		},
		Message: "Finding",
	}}
	position := protocol.Position{Line: 1, Character: 0}
	got, changed := applyDocumentChanges(uri, diagnostics, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "alpha\nbeta\n",
	}})

	want := protocol.Range{
		Start: protocol.Position{Line: 6, Character: 2},
		End:   protocol.Position{Line: 6, Character: 6},
	}
	if !changed || got[0].Range != want {
		t.Fatalf("transformed range = %#v, changed %v; want %#v, true", got[0].Range, changed, want)
	}
	if diagnostics[0].Range.Start.Line != 4 {
		t.Fatalf("input diagnostics were mutated: %#v", diagnostics[0].Range)
	}
}

func TestApplyDocumentChangesCollapsesOverlappingDiagnosticAtReplacementEnd(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	diagnostics := []protocol.Diagnostic{{
		Range: protocol.Range{
			Start: protocol.Position{Line: 4, Character: 2},
			End:   protocol.Position{Line: 4, Character: 8},
		},
		Message: "Finding",
	}}
	got, changed := applyDocumentChanges(uri, diagnostics, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{
			Start: protocol.Position{Line: 4, Character: 4},
			End:   protocol.Position{Line: 4, Character: 6},
		},
		Text: "😀\nnext",
	}})

	want := protocol.Range{
		Start: protocol.Position{Line: 5, Character: 4},
		End:   protocol.Position{Line: 5, Character: 4},
	}
	if !changed || got[0].Range != want {
		t.Fatalf("collapsed range = %#v, changed %v; want %#v, true", got[0].Range, changed, want)
	}
}

func TestApplyDocumentChangesMovesOnlySameDocumentRelatedInformation(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	rangeAtLine := func(line uint32) protocol.Range {
		return protocol.Range{
			Start: protocol.Position{Line: line, Character: 1},
			End:   protocol.Position{Line: line, Character: 3},
		}
	}
	diagnostics := []protocol.Diagnostic{{
		Range: rangeAtLine(4),
		RelatedInformation: []protocol.DiagnosticRelatedInformation{
			{Location: protocol.Location{URI: uri, Range: rangeAtLine(6)}, Message: "same file"},
			{Location: protocol.Location{URI: "file:///repo/src/other.ts", Range: rangeAtLine(8)}, Message: "other file"},
		},
		Message: "Finding",
	}}
	position := protocol.Position{Line: 1, Character: 0}
	got, changed := applyDocumentChanges(uri, diagnostics, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})

	if !changed || got[0].RelatedInformation[0].Location.Range != rangeAtLine(7) {
		t.Fatalf("same-file related range = %#v, changed %v", got[0].RelatedInformation[0].Location.Range, changed)
	}
	if got[0].RelatedInformation[1].Location.Range != rangeAtLine(8) {
		t.Fatalf("other-file related range moved to %#v", got[0].RelatedInformation[1].Location.Range)
	}
}

func TestApplyDocumentChangesPositionMatrix(t *testing.T) {
	t.Parallel()

	position := func(line, character uint32) protocol.Position {
		return protocol.Position{Line: line, Character: character}
	}
	rangeBetween := func(startLine, startCharacter, endLine, endCharacter uint32) protocol.Range {
		return protocol.Range{
			Start: position(startLine, startCharacter),
			End:   position(endLine, endCharacter),
		}
	}
	change := func(edit protocol.Range, text string) protocol.TextDocumentContentChangeEvent {
		return protocol.TextDocumentContentChangeEvent{Range: &edit, Text: text}
	}
	tests := []struct {
		name    string
		target  protocol.Range
		changes []protocol.TextDocumentContentChangeEvent
		want    protocol.Range
		changed bool
	}{
		{
			name:   "delete lines above",
			target: rangeBetween(5, 2, 5, 6),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(1, 0, 3, 0), ""),
			},
			want: rangeBetween(3, 2, 3, 6), changed: true,
		},
		{
			name:   "insert emoji and CJK before on same line counts UTF-16",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 2, 4, 2), "😀界"),
			},
			want: rangeBetween(4, 8, 4, 11), changed: true,
		},
		{
			name:   "delete characters before on same line",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 1, 4, 3), ""),
			},
			want: rangeBetween(4, 3, 4, 6), changed: true,
		},
		{
			name:   "insertion exactly at start moves",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 5, 4, 5), "x"),
			},
			want: rangeBetween(4, 6, 4, 9), changed: true,
		},
		{
			name:   "insertion exactly at end does not move",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 8, 4, 8), "x"),
			},
			want: rangeBetween(4, 5, 4, 8), changed: false,
		},
		{
			name:   "insertion at zero-width marker moves right",
			target: rangeBetween(4, 5, 4, 5),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 5, 4, 5), "😀"),
			},
			want: rangeBetween(4, 7, 4, 7), changed: true,
		},
		{
			name:   "deletion ending at zero-width marker moves left",
			target: rangeBetween(4, 5, 4, 5),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(4, 2, 4, 5), ""),
			},
			want: rangeBetween(4, 2, 4, 2), changed: true,
		},
		{
			name:   "ordered changes use the first changes post-state",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(1, 0, 1, 0), "\n"),
				change(rangeBetween(5, 2, 5, 2), "ab"),
			},
			want: rangeBetween(5, 7, 5, 10), changed: true,
		},
		{
			name:   "CRLF and CR each count as one inserted line",
			target: rangeBetween(3, 1, 3, 3),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(1, 0, 1, 0), "a\r\nb\rc"),
			},
			want: rangeBetween(5, 1, 5, 3), changed: true,
		},
		{
			name:   "edit after diagnostic is unchanged",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(6, 0, 6, 0), "\n"),
			},
			want: rangeBetween(4, 5, 4, 8), changed: false,
		},
		{
			name:   "full document replacement cannot transform",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				{Text: "replacement"},
			},
			want: rangeBetween(4, 5, 4, 8), changed: false,
		},
		{
			name:   "full document replacement invalidates every ranged edit in its batch",
			target: rangeBetween(4, 5, 4, 8),
			changes: []protocol.TextDocumentContentChangeEvent{
				change(rangeBetween(1, 0, 1, 0), "\n"),
				{Text: "replacement"},
				change(rangeBetween(5, 0, 5, 0), "later"),
			},
			want: rangeBetween(4, 5, 4, 8), changed: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			diagnostics := []protocol.Diagnostic{{Range: test.target, Message: "Finding"}}
			got, changed := applyDocumentChanges("file:///repo/src/writer.ts", diagnostics, test.changes)
			if changed != test.changed || got[0].Range != test.want {
				t.Fatalf("range = %#v, changed %v; want %#v, %v", got[0].Range, changed, test.want, test.changed)
			}
		})
	}
}
