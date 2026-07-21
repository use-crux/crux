package server

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherPublishesInitialViewDiffsAndClears(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{publisherFinding("first", "src/a.ts", "recommended", false)},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify, Debounce: 20 * time.Millisecond,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	first := recorder.wait(t, 1)[0]
	if first.URI != "file:///repo/src/a.ts" || len(first.Diagnostics) != 1 {
		t.Fatalf("initial diagnostics = %#v", first)
	}

	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	recorder.assertCountAfter(t, 1, 30*time.Millisecond)

	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	cleared := recorder.wait(t, 2)[1]
	if cleared.URI != first.URI || len(cleared.Diagnostics) != 0 || cleared.Diagnostics == nil {
		t.Fatalf("clear diagnostics = %#v, want non-nil empty diagnostics", cleared)
	}
}

func TestPublisherDebouncesDeltaBurstsAndPublishesNewestView(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{Generation: &generation})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify, Debounce: 20 * time.Millisecond,
	})
	t.Cleanup(publisher.Close)

	for _, id := range []string{"old", "new"} {
		result := store.ApplyDelta("scope", readmodel.Delta{
			Generation: generation,
			File:       "src/a.ts",
			Lints: &readmodel.LintReplacement{Findings: []api.IndexLintFinding{
				publisherFinding(id, "src/a.ts", "recommended", false),
			}},
		})
		publisher.Change(readmodel.Change{Scope: "scope", Files: result.ChangedFiles})
	}

	published := recorder.wait(t, 1)[0]
	if len(published.Diagnostics) != 1 || diagnosticID(t, published.Diagnostics[0]) != "new" {
		t.Fatalf("debounced diagnostics = %#v, want newest finding", published.Diagnostics)
	}
	recorder.assertCountAfter(t, 1, 30*time.Millisecond)
}

func TestPublisherDidOpenForcesCurrentFileAndSettingsRefilter(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{
			publisherFinding("recommended", "src/a.ts", "recommended", false),
			publisherFinding("strict", "src/a.ts", "strict", false),
			publisherFinding("suppressed", "src/a.ts", "strict", true),
		},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: "/repo", ConfigFile: "/repo/crux.config.ts",
		Store: store, Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)

	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
	if got := len(recorder.wait(t, 1)[0].Diagnostics); got != 2 {
		t.Fatalf("default diagnostic count = %d, want 2", got)
	}

	publisher.DidOpen(protocol.DocumentURI("file:///repo/src/a.ts"), 1)
	if got := len(recorder.wait(t, 2)[1].Diagnostics); got != 2 {
		t.Fatalf("didOpen diagnostic count = %d, want 2", got)
	}

	publisher.UpdateFilter(mapping.FilterOptions{Profile: "strict", IncludeSuppressed: true})
	filtered := recorder.wait(t, 3)[2]
	if got := len(filtered.Diagnostics); got != 2 {
		t.Fatalf("strict included diagnostic count = %d, want 2", got)
	}
	if filtered.Diagnostics[1].Tags[0] != protocol.DiagnosticTagUnnecessary {
		t.Fatalf("suppressed diagnostic tags = %#v", filtered.Diagnostics[1].Tags)
	}

	publisher.UpdateFilter(mapping.FilterOptions{Profile: "off"})
	cleared := recorder.wait(t, 4)[3]
	if len(cleared.Diagnostics) != 0 || cleared.Diagnostics == nil {
		t.Fatalf("profile off diagnostics = %#v, want non-nil empty clear", cleared.Diagnostics)
	}
}

func TestPublisherHoldsNewestAuthoritativeViewAcrossDirtyHandover(t *testing.T) {
	store := readmodel.NewStore()
	generation := uint64(1)
	initial := publisherFinding("initial", "src/a.ts", "recommended", false)
	initial.Source.Line = 5
	column := 3
	initial.Source.Column = &column
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings:   []api.IndexLintFinding{initial},
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
	publisher.DidOpen(uri, 1)
	recorder.wait(t, 2)
	position := protocol.Position{Line: 0, Character: 0}
	publisher.DidChange(uri, 2, []protocol.TextDocumentContentChangeEvent{{
		Range: &protocol.Range{Start: position, End: position},
		Text:  "\n",
	}})
	recorder.wait(t, 3)

	for index, id := range []string{"held-old", "held-new"} {
		nextGeneration := uint64(index + 2)
		store.ApplySnapshot("scope", readmodel.Snapshot{
			Generation: &nextGeneration,
			Findings:   []api.IndexLintFinding{publisherFinding(id, "src/a.ts", "recommended", false)},
		})
		publisher.Change(readmodel.Change{Scope: "scope", Files: []string{"src/a.ts"}, Immediate: true})
		recorder.assertCountAfter(t, 3, 20*time.Millisecond)
	}

	publisher.DidSave(uri)
	published := recorder.wait(t, 4)[3]
	if len(published.Diagnostics) != 1 || diagnosticID(t, published.Diagnostics[0]) != "held-new" {
		t.Fatalf("saved diagnostics = %#v, want newest held authoritative view", published.Diagnostics)
	}
}

type diagnosticRecorder struct {
	mu     sync.Mutex
	values []protocol.PublishDiagnosticsParams
	wake   chan struct{}
}

func newDiagnosticRecorder() *diagnosticRecorder {
	return &diagnosticRecorder{wake: make(chan struct{}, 16)}
}

func (r *diagnosticRecorder) notify(method string, params any) {
	if method != protocol.MethodPublishDiagnostics {
		return
	}
	r.mu.Lock()
	r.values = append(r.values, params.(protocol.PublishDiagnosticsParams))
	r.mu.Unlock()
	r.wake <- struct{}{}
}

func (r *diagnosticRecorder) wait(t *testing.T, count int) []protocol.PublishDiagnosticsParams {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		r.mu.Lock()
		values := append([]protocol.PublishDiagnosticsParams(nil), r.values...)
		r.mu.Unlock()
		if len(values) >= count {
			return values
		}
		select {
		case <-r.wake:
		case <-deadline:
			t.Fatalf("published %d notifications, want %d", len(values), count)
		}
	}
}

func (r *diagnosticRecorder) assertCountAfter(t *testing.T, want int, duration time.Duration) {
	t.Helper()
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-r.wake:
	case <-timer.C:
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.values) != want {
		t.Fatalf("published %d notifications, want %d", len(r.values), want)
	}
}

func publisherFinding(id, file, profile string, suppressed bool) api.IndexLintFinding {
	return api.IndexLintFinding{
		ID: id, RuleID: "test." + id, Severity: "warning", Title: id,
		Profiles: []string{profile}, Suppressed: suppressed,
		Source: &api.SourceLoc{File: file, Line: 1},
	}
}

func diagnosticID(t *testing.T, diagnostic protocol.Diagnostic) string {
	t.Helper()
	var data struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(diagnostic.Data, &data); err != nil {
		t.Fatalf("decode diagnostic data: %v", err)
	}
	return data.ID
}
