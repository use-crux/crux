package server

import (
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestApplyDocumentChangesReassignsMultipleDiagnosticRanges(t *testing.T) {
	t.Parallel()

	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	otherURI := protocol.DocumentURI("file:///repo/src/other.ts")
	rangeAtLine := func(line uint32) protocol.Range {
		return protocol.Range{
			Start: protocol.Position{Line: line, Character: 1},
			End:   protocol.Position{Line: line, Character: 3},
		}
	}
	diagnostics := []protocol.Diagnostic{
		{
			Range: rangeAtLine(4),
			RelatedInformation: []protocol.DiagnosticRelatedInformation{
				{Location: protocol.Location{URI: uri, Range: rangeAtLine(6)}},
				{Location: protocol.Location{URI: otherURI, Range: rangeAtLine(8)}},
			},
		},
		{
			Range: rangeAtLine(10),
			RelatedInformation: []protocol.DiagnosticRelatedInformation{
				{Location: protocol.Location{URI: otherURI, Range: rangeAtLine(12)}},
				{Location: protocol.Location{URI: uri, Range: rangeAtLine(14)}},
			},
		},
	}
	position := protocol.Position{Line: 1, Character: 0}

	got, changed := applyDocumentChanges(uri, diagnostics, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})

	if !changed {
		t.Fatal("multiple diagnostic ranges did not move")
	}
	wantLines := [][]uint32{{5, 7, 8}, {11, 12, 15}}
	if len(got) != len(wantLines) {
		t.Fatalf("diagnostic count = %d; want %d", len(got), len(wantLines))
	}
	for diagnosticIndex, diagnostic := range got {
		lines := []uint32{diagnostic.Range.Start.Line}
		for _, related := range diagnostic.RelatedInformation {
			lines = append(lines, related.Location.Range.Start.Line)
		}
		if !reflect.DeepEqual(lines, wantLines[diagnosticIndex]) {
			t.Fatalf("diagnostic %d range lines = %v; want %v", diagnosticIndex, lines, wantLines[diagnosticIndex])
		}
	}
}

func TestRangeChangeAdaptersHandleNilAndEmptyInputs(t *testing.T) {
	t.Parallel()

	gotRanges, changed := applyRangeChanges(nil, nil)
	if changed || gotRanges != nil {
		t.Fatalf("nil ranges and changes = %#v, %v; want nil, false", gotRanges, changed)
	}

	gotRanges, changed = applyRangeChanges([]protocol.Range{}, []protocol.TextDocumentContentChangeEvent{})
	if changed || len(gotRanges) != 0 {
		t.Fatalf("empty ranges and changes = %#v, %v; want empty, false", gotRanges, changed)
	}

	ranges := []protocol.Range{{Start: protocol.Position{Line: 2}, End: protocol.Position{Line: 3}}}
	gotRanges, changed = applyRangeChanges(ranges, nil)
	if changed || !reflect.DeepEqual(gotRanges, ranges) {
		t.Fatalf("ranges with nil changes = %#v, %v; want %#v, false", gotRanges, changed, ranges)
	}
	gotRanges[0] = protocol.Range{}
	if ranges[0] == (protocol.Range{}) {
		t.Fatal("unchanged ranges alias the input")
	}

	gotDiagnostics, changed := applyDocumentChanges("", nil, nil)
	if changed || gotDiagnostics != nil {
		t.Fatalf("nil diagnostics and changes = %#v, %v; want nil, false", gotDiagnostics, changed)
	}
	gotDiagnostics, changed = applyDocumentChanges("", []protocol.Diagnostic{}, nil)
	if changed || len(gotDiagnostics) != 0 {
		t.Fatalf("empty diagnostics = %#v, %v; want empty, false", gotDiagnostics, changed)
	}
}
