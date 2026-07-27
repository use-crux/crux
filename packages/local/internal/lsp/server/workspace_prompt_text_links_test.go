package server

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkspacePromptTextLinksMatchInOwnAndAttachedModes(t *testing.T) {
	t.Parallel()

	for _, mode := range []readmodel.Mode{readmodel.ModeOwn, readmodel.ModeAttached} {
		mode := mode
		t.Run(string(mode), func(t *testing.T) {
			t.Parallel()

			fixture := newWorkspacePromptTextLinkFixture(t, mode)
			result := fixture.workspace.PromptTextLinks(
				context.Background(),
				fixture.uri,
				fixture.file,
			)
			wantTarget := protocol.DocumentURI(mapping.FileURI(
				"",
				filepath.Join(fixture.root, "src", "guide.md"),
			))
			if len(result.Links) != 1 || result.Links[0].Target != wantTarget {
				t.Fatalf("links = %#v, want target %q", result, wantTarget)
			}
		})
	}
}

func TestWorkspacePromptTextLinksRejectSourceEpochAdvance(t *testing.T) {
	t.Parallel()

	fixture := newWorkspacePromptTextLinkFixture(t, readmodel.ModeOwn)
	fixture.source.started = make(chan struct{})
	fixture.source.release = make(chan struct{})
	done := make(chan lsprompttext.LinkResult, 1)
	go func() {
		done <- fixture.workspace.PromptTextLinks(
			context.Background(),
			fixture.uri,
			fixture.file,
		)
	}()
	<-fixture.source.started
	fixture.workspace.mu.Lock()
	fixture.session.sourceEpoch++
	fixture.workspace.mu.Unlock()
	close(fixture.source.release)

	result := <-done
	if result.Links == nil || len(result.Links) != 0 {
		t.Fatalf("source-epoch-advanced links = %#v, want exact empty", result)
	}
}

type workspacePromptTextLinkFixture struct {
	root      string
	file      string
	uri       protocol.DocumentURI
	source    *controlledPromptTextLinkSource
	session   *scopeSession
	workspace *workspaceRuntime
}

func newWorkspacePromptTextLinkFixture(
	t *testing.T,
	mode readmodel.Mode,
) workspacePromptTextLinkFixture {
	t.Helper()

	root := t.TempDir()
	file := filepath.Join(root, "src", "writer.ts")
	uri := protocol.DocumentURI(mapping.FileURI("", file))
	const text = "const value = md`[guide](./guide.md)`;\n"
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	store := readmodel.NewStore()
	generation := uint64(4)
	endColumn := len(text) - 1
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer",
			SourceRefs: []api.ProjectSourceRef{{
				ID: "prompt:writer:source:prompt-text", Fidelity: "resolved",
				Source: api.SourceLoc{
					File: file, Line: 1, Column: symbolInt(15),
				},
				Snippet: &api.SourceSnippet{
					Source: text[14 : len(text)-2], Language: "typescript",
					Range: api.SourceRange{
						File: file, StartLine: 1, StartColumn: symbolInt(15),
						EndLine: symbolInt(1), EndColumn: &endColumn,
					},
				},
				Metadata: map[string]any{"promptText": map[string]any{
					"language": "markdown", "lifecycle": "static",
				}},
			}},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
		}},
	})
	source := &controlledPromptTextLinkSource{}
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root},
		views: indexview.NewSavedProvider(store),
		mode:  mode, transient: source, sourceEpoch: 1,
	}
	return workspacePromptTextLinkFixture{
		root: root, file: file, uri: uri, source: source, session: session,
		workspace: &workspaceRuntime{
			server: server, store: store, sessions: []*scopeSession{session},
		},
	}
}

type controlledPromptTextLinkSource struct {
	started chan struct{}
	release chan struct{}
}

func (*controlledPromptTextLinkSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *controlledPromptTextLinkSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	if s.started != nil {
		close(s.started)
		select {
		case <-ctx.Done():
			return readmodel.PromptTextResult{}, ctx.Err()
		case <-s.release:
		}
	}
	textRange := symbolRange(0, 18, 0, 23)
	destinationRange := symbolRange(0, 25, 0, 35)
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File, Revision: request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range:    symbolRange(0, 14, 0, 37),
			TagRange: symbolRange(0, 14, 0, 16),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: symbolRange(0, 17, 0, 36),
			}},
			Links: []staticprotocol.PromptTextLink{{
				Kind: staticprotocol.PromptTextLinkInline, Island: 0,
				Range: symbolRange(0, 17, 0, 36), TextRange: textRange,
				DestinationRange: &destinationRange, Destination: "./guide.md",
			}},
		}},
	}, nil
}
