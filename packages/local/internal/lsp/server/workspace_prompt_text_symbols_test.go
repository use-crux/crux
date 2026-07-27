package server

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	lsprompttext "github.com/use-crux/crux/packages/local/internal/lsp/prompttext"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestWorkspacePromptTextSymbolsRejectSourceEpochAdvance(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	file := filepath.Join(root, "src", "writer.ts")
	uri := protocol.DocumentURI("file://" + filepath.ToSlash(file))
	const source = "const value = md`# Title`;\n"
	server := New(Options{})
	server.buffers.Open(protocol.TextDocumentItem{
		URI: uri, LanguageID: "typescript", Version: 1, Text: source,
	})
	document, ok := server.buffers.Snapshot(uri)
	if !ok {
		t.Fatal("open document was not retained")
	}
	store := readmodel.NewStore()
	generation := uint64(4)
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer",
			SourceRefs: []api.ProjectSourceRef{{
				ID:       "prompt:writer:source:prompt:prompt-text",
				Fidelity: "resolved",
				Source:   api.SourceLoc{File: file, Line: 1, Column: symbolInt(15)},
				Snippet: &api.SourceSnippet{
					Source: "md`# Title`", Language: "typescript",
					Range: api.SourceRange{
						File: file, StartLine: 1, StartColumn: symbolInt(15),
						EndLine: symbolInt(1), EndColumn: symbolInt(26),
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
	analyzer := &controlledPromptTextSymbolSource{
		started: make(chan struct{}), release: make(chan struct{}),
	}
	session := &scopeSession{
		scope: readmodel.Scope{ID: "scope", Root: root},
		views: indexview.NewSavedProvider(store),
		mode:  readmodel.ModeOwn, transient: analyzer, sourceEpoch: 1,
	}
	workspace := &workspaceRuntime{
		server: server, store: store, sessions: []*scopeSession{session},
	}

	done := make(chan lsprompttext.SymbolResult, 1)
	go func() {
		done <- workspace.PromptTextSymbols(context.Background(), uri, file)
	}()
	<-analyzer.started
	workspace.mu.Lock()
	session.sourceEpoch++
	workspace.mu.Unlock()
	close(analyzer.release)

	result := <-done
	if result.Revision != document.Revision || result.Symbols == nil ||
		len(result.Symbols) != 0 {
		t.Fatalf("source-epoch-advanced symbols = %#v, want exact empty", result)
	}
}

type controlledPromptTextSymbolSource struct {
	started chan struct{}
	release chan struct{}
}

func (*controlledPromptTextSymbolSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *controlledPromptTextSymbolSource) PromptText(
	ctx context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	close(s.started)
	select {
	case <-ctx.Done():
		return readmodel.PromptTextResult{}, ctx.Err()
	case <-s.release:
	}
	label := "Title"
	textRange := symbolRange(0, 19, 0, 24)
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File, Revision: request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range:    symbolRange(0, 14, 0, 25),
			TagRange: symbolRange(0, 14, 0, 16),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: symbolRange(0, 17, 0, 24),
			}},
			Blocks: []staticprotocol.PromptTextBlock{{
				Kind: staticprotocol.PromptTextBlockHeading, Level: 1,
				Label: &label, Range: symbolRange(0, 17, 0, 24),
				TextRange: &textRange,
			}},
		}},
	}, nil
}

func symbolRange(
	startLine, startCharacter, endLine, endCharacter uint32,
) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{
			Line: startLine, Character: startCharacter,
		},
		End: staticprotocol.PromptTextPosition{
			Line: endLine, Character: endCharacter,
		},
	}
}

func symbolInt(value int) *int { return &value }
