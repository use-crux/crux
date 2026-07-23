package server

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDidOpenHoldsAuthoritativePositionsForAnotherDirtyDocument(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	left := publisherFinding("left", "src/a.ts", "recommended", false)
	left.Source.Line = 5
	right := publisherFinding("right", "src/b.ts", "recommended", false)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{left, right},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	leftURI := protocol.DocumentURI("file:///repo/src/a.ts")
	rightURI := protocol.DocumentURI("file:///repo/src/b.ts")

	publisher.Change(readmodel.Change{Scope: "scope", Immediate: true})
	recorder.wait(t, 2)
	publisher.DidOpen(leftURI, 1)
	opened := recorder.wait(t, 3)[2]
	position := protocol.Position{}
	publisher.DidChange(leftURI, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position}, Text: "\n",
	}})
	shifted := recorder.wait(t, 4)[3]
	if shifted.Diagnostics[0].Range.Start.Line != opened.Diagnostics[0].Range.Start.Line+1 {
		t.Fatalf("shifted range = %#v, opened = %#v", shifted.Diagnostics[0].Range, opened.Diagnostics[0].Range)
	}

	publisher.DidOpen(rightURI, 1)
	values := recorder.wait(t, 5)
	recorder.assertCountAfter(t, 5, 20*time.Millisecond)
	if values[4].URI != rightURI {
		t.Fatalf("didOpen notification URI = %s, want only %s", values[4].URI, rightURI)
	}

	publisher.DidSave(leftURI)
	restored := recorder.wait(t, 6)[5]
	if restored.URI != leftURI || restored.Diagnostics[0].Range != opened.Diagnostics[0].Range {
		t.Fatalf("saved diagnostics = %#v, want held disk range %#v", restored, opened.Diagnostics[0].Range)
	}
}
