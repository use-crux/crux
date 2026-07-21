package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDidSaveInvalidatesUTF16LineCache(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "source.ts")
	if err := os.WriteFile(file, []byte("😀x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 5
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{{
			ID: "finding", RuleID: "test.rule", Severity: "warning", Title: "Finding",
			Source: &api.SourceLoc{File: file, Line: 1, Column: &column},
		}},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: root, ConfigFile: filepath.Join(root, "crux.config.ts"),
		Store: store, Lines: mapping.NewLineIndex(), Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{file}, Immediate: true})
	if got := recorder.wait(t, 1)[0].Diagnostics[0].Range.Start.Character; got != 2 {
		t.Fatalf("emoji UTF-16 character = %d, want 2", got)
	}

	if err := os.WriteFile(file, []byte("abcx\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	publisher.DidSave(uri)
	publisher.DidOpen(uri)
	if got := recorder.wait(t, 2)[1].Diagnostics[0].Range.Start.Character; got != 4 {
		t.Fatalf("saved UTF-16 character = %d, want refreshed value 4", got)
	}
}

func TestPublisherSourceOnlyDeltaInvalidatesUTF16LineCache(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "source.ts")
	if err := os.WriteFile(file, []byte("😀x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	column := 5
	store := readmodel.NewStore()
	generation := uint64(1)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Findings: []api.IndexLintFinding{{
			ID: "finding", RuleID: "test.rule", Severity: "warning", Title: "Finding",
			Source: &api.SourceLoc{File: file, Line: 1, Column: &column},
		}},
	})
	recorder := newDiagnosticRecorder()
	publisher := NewPublisher(PublisherOptions{
		ScopeID: "scope", Root: root, ConfigFile: filepath.Join(root, "crux.config.ts"),
		Store: store, Lines: mapping.NewLineIndex(), Notify: recorder.notify,
	})
	t.Cleanup(publisher.Close)
	publisher.Change(readmodel.Change{Scope: "scope", Files: []string{file}, Immediate: true})
	if got := recorder.wait(t, 1)[0].Diagnostics[0].Range.Start.Character; got != 2 {
		t.Fatalf("emoji UTF-16 character = %d, want 2", got)
	}

	if err := os.WriteFile(file, []byte("abcx\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	result := store.ApplyDelta("scope", readmodel.Delta{
		Generation: 2, File: file, SourceChanged: true,
	})
	publisher.Change(readmodel.Change{
		Scope: "scope", Files: result.ChangedFiles, Immediate: true,
	})
	if got := recorder.wait(t, 2)[1].Diagnostics[0].Range.Start.Character; got != 4 {
		t.Fatalf("source-delta UTF-16 character = %d, want refreshed value 4", got)
	}
}
