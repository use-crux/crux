package server

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDidChangePublishesShiftedDiagnosticsAndRejectsRegressiveVersion(t *testing.T) {
	_, publisher, recorder, uri := newDocumentStatePublisher(t)
	var logMu sync.Mutex
	var logs []string
	publisher.options.Log = func(message string) {
		logMu.Lock()
		defer logMu.Unlock()
		logs = append(logs, message)
	}

	publisher.DidOpen(uri, 1)
	opened := recorder.wait(t, 2)[1]
	before := opened.Diagnostics[0].Range
	position := protocol.Position{Line: 0, Character: 0}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})
	shifted := recorder.wait(t, 3)[2]
	if shifted.Diagnostics[0].Range.Start.Line != before.Start.Line+1 ||
		shifted.Diagnostics[0].Range.End.Line != before.End.Line+1 {
		t.Fatalf("shifted range = %#v, want one line after %#v", shifted.Diagnostics[0].Range, before)
	}

	after := protocol.Position{Line: 99, Character: 0}
	publisher.DidChange(uri, 3, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: after, End: after},
		Text:  "\n",
	}})
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)

	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)
	logMu.Lock()
	defer logMu.Unlock()
	if len(logs) != 1 || !strings.Contains(logs[0], "version 2") {
		t.Fatalf("regressive-version logs = %q, want one entry naming version 2", logs)
	}
}

func TestPublisherFullDocumentChangeTracesOncePerURISession(t *testing.T) {
	_, publisher, recorder, uri := newDocumentStatePublisher(t)
	var traceMu sync.Mutex
	var traces []string
	publisher.options.Trace = func(message string) {
		traceMu.Lock()
		defer traceMu.Unlock()
		traces = append(traces, message)
	}

	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "first replacement"}})
	publisher.DidChange(uri, 3, []protocol.TextDocumentContentChangeEvent{{Text: "second replacement"}})
	publisher.DidClose(uri)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 3)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "third replacement"}})
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)

	traceMu.Lock()
	defer traceMu.Unlock()
	if len(traces) != 1 || !strings.Contains(traces[0], string(uri)) {
		t.Fatalf("full-document traces = %q, want one entry naming %s", traces, uri)
	}
}

func TestPublisherAppliesAuthoritativeClearWhileDocumentIsDirty(t *testing.T) {
	store, publisher, recorder, uri := newDocumentStatePublisher(t)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "dirty replacement"}})

	generation := uint64(2)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	cleared := recorder.wait(t, 3)[2]
	if len(cleared.Diagnostics) != 0 || cleared.Diagnostics == nil {
		t.Fatalf("dirty authoritative clear = %#v, want non-nil empty diagnostics", cleared.Diagnostics)
	}
}

func TestPublisherHoldsDirtySettingsRefilterInSharedLatestAuthoritativeSlot(t *testing.T) {
	store, publisher, recorder, uri := newDocumentStatePublisher(t)
	generation := uint64(2)
	initial := publisherFinding("initial", "src/a.ts", "recommended", false)
	initial.Source.Line = 5
	column := 3
	initial.Source.Column = &column
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{
			initial,
			publisherFinding("suppressed", "src/a.ts", "recommended", true),
		},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.assertCountAfter(t, 1, 20*time.Millisecond)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	position := protocol.Position{Line: 0, Character: 0}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})
	recorder.wait(t, 3)

	publisher.UpdateFilter(mapping.FilterOptions{IncludeSuppressed: true})
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)
	generation = 3
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{publisherFinding("reindexed", "src/a.ts", "recommended", false)},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.assertCountAfter(t, 3, 20*time.Millisecond)

	publisher.DidSave(uri)
	published := recorder.wait(t, 4)[3]
	if len(published.Diagnostics) != 1 || diagnosticID(t, published.Diagnostics[0]) != "reindexed" {
		t.Fatalf("saved diagnostics = %#v, want reindex view that superseded held settings view", published.Diagnostics)
	}
}

func TestPublisherAppliesSettingsClearWhileDocumentIsDirty(t *testing.T) {
	_, publisher, recorder, uri := newDocumentStatePublisher(t)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "dirty replacement"}})

	publisher.UpdateFilter(mapping.FilterOptions{Profile: "off"})
	cleared := recorder.wait(t, 3)[2]
	if len(cleared.Diagnostics) != 0 || cleared.Diagnostics == nil {
		t.Fatalf("dirty settings clear = %#v, want non-nil empty diagnostics", cleared.Diagnostics)
	}
}

func TestPublisherDidCloseDropsHeldViewAndNextAuthoritativeChangePublishes(t *testing.T) {
	store, publisher, recorder, uri := newDocumentStatePublisher(t)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{Text: "dirty replacement"}})

	generation := uint64(2)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{publisherFinding("held", "src/a.ts", "recommended", false)},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.assertCountAfter(t, 2, 20*time.Millisecond)
	publisher.DidClose(uri)

	generation = 3
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{publisherFinding("closed", "src/a.ts", "recommended", false)},
	})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	published := recorder.wait(t, 3)[2]
	if len(published.Diagnostics) != 1 || diagnosticID(t, published.Diagnostics[0]) != "closed" {
		t.Fatalf("closed authoritative diagnostics = %#v, want closed finding", published.Diagnostics)
	}
}

func TestPublisherSerializesConcurrentDidChangeAndAuthoritativePublish(t *testing.T) {
	store, publisher, recorder, uri := newDocumentStatePublisher(t)
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	position := protocol.Position{Line: 0, Character: 0}
	start := make(chan struct{})
	var calls sync.WaitGroup
	calls.Add(2)
	go func() {
		defer calls.Done()
		<-start
		publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
			Range: &protocol.Range{Start: position, End: position},
			Text:  "\n",
		}})
	}()
	go func() {
		defer calls.Done()
		<-start
		generation := uint64(2)
		finding := publisherFinding("concurrent", "src/a.ts", "recommended", false)
		finding.Source.Line = 5
		column := 3
		finding.Source.Column = &column
		store.ApplySnapshot("scope", readmodel.Snapshot{
			Generation: &generation,
			Findings:   []api.IndexLintFinding{finding},
		})
		publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	}()
	close(start)
	calls.Wait()
	publisher.DidSave(uri)

	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	for index, published := range recorder.values {
		if len(published.Diagnostics) != 1 {
			t.Fatalf("notification %d diagnostics = %#v, want one coherent view", index, published.Diagnostics)
		}
	}
}

func TestPublisherDisplayedFindingsFollowShiftedZeroWidthRange(t *testing.T) {
	_, publisher, recorder, uri := newDocumentStatePublisher(t)
	publisher.DidOpen(uri, 1)
	opened := recorder.wait(t, 2)[1]
	before := opened.Diagnostics[0].Range.Start
	initial := publisher.DisplayedFindings(uri, before)
	if len(initial) != 1 || initial[0].Finding.ID != "initial" {
		t.Fatalf("initial displayed findings = %#v, want initial", initial)
	}

	position := protocol.Position{Line: 0, Character: 0}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})
	shifted := recorder.wait(t, 3)[2].Diagnostics[0].Range.Start
	if matches := publisher.DisplayedFindings(uri, before); len(matches) != 0 {
		t.Fatalf("old displayed position still matched %#v", matches)
	}
	matches := publisher.DisplayedFindings(uri, shifted)
	if len(matches) != 1 || matches[0].Diagnostic.Range.Start != shifted || matches[0].Finding.ID != "initial" {
		t.Fatalf("shifted displayed findings = %#v, want shifted initial", matches)
	}
}

func TestPublisherDisplayedFindingsMatchesMultipleWholeLineDiagnostics(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{
			publisherFinding("bravo", "src/a.ts", "recommended", false),
			publisherFinding("alpha", "src/a.ts", "recommended", false),
		},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	uri := protocol.DocumentURI("file:///repo/src/a.ts")
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.wait(t, 1)

	matches := publisher.DisplayedFindings(uri, protocol.Position{Line: 0, Character: 50})
	if len(matches) != 2 || matches[0].Finding.ID != "alpha" || matches[1].Finding.ID != "bravo" {
		t.Fatalf("whole-line displayed matches = %#v, want alpha then bravo", matches)
	}
}

func newDocumentStatePublisher(t *testing.T) (*readmodel.Store, *Publisher, *diagnosticRecorder, protocol.DocumentURI) {
	t.Helper()
	store := readmodel.NewStore()
	generation := uint64(1)
	finding := publisherFinding("initial", "src/a.ts", "recommended", false)
	finding.Source.Line = 5
	column := 3
	finding.Source.Column = &column
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{finding},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.wait(t, 1)
	return store, publisher, recorder, "file:///repo/src/a.ts"
}
