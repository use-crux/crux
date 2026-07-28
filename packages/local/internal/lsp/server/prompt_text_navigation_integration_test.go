package server

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextDefinitionCrossesPublicationTransientAndLSPBoundaries(
	t *testing.T,
) {
	for _, mode := range []readmodel.Mode{
		readmodel.ModeOwn,
		readmodel.ModeAttached,
	} {
		for _, tag := range []string{"md", "text", "core.md", "render"} {
			t.Run(string(mode)+"/"+tag, func(t *testing.T) {
				const prefix = "const value = "
				template := tag + "`hello`"
				source := prefix + template + ";\nconst owner = 1;\n"
				root := t.TempDir()
				file := navigationTestFile(t, root, "source.ts", source)
				uri := protocol.DocumentURI(mapping.FileURI(root, file))
				templateRange := integrationRange(
					0,
					len(prefix),
					len(prefix)+len(template),
				)
				generation := uint64(1)
				store := readmodel.NewStore()
				store.ApplySnapshot("scope", readmodel.Snapshot{
					Generation: &generation,
					Indexing: &api.ProjectIndexingStatus{
						Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
					},
					Definitions: []api.ProjectDefinition{
						integrationPromptTextDefinition(file, template, templateRange),
					},
					Sources: []api.IndexSourceFile{{
						File: file, SourceHash: promptTextViewHash(source),
					}},
				})
				server := New(Options{})
				server.buffers.Open(protocol.TextDocumentItem{
					URI: uri, LanguageID: "typescript", Version: 1, Text: source,
				})
				document, ok := server.buffers.Snapshot(uri)
				if !ok {
					t.Fatal("open document unavailable")
				}
				saved := indexview.NewSavedProvider(store)
				views := promptview.NewProvider(
					saved,
					promptview.Options{Root: root},
				)
				revision := promptTextViewRevision(document)
				if !views.Open(promptview.Request{
					ScopeID: "scope", File: file, Document: &revision,
					MinimumEvidence: indexview.EvidenceSemantic,
					Freshness:       indexview.AllowSavedFallback,
				}) {
					t.Fatal("exact transformed view was not established")
				}
				transientSource := integrationNavigationSource{
					template: templateRange,
					open:     len(prefix) + len(tag),
					close:    len(prefix) + len(template) - 1,
				}
				session := &scopeSession{
					scope: readmodel.Scope{ID: "scope", Root: root},
					mode:  mode, transient: transientSource,
					sourceEpoch: 1, promptTextViews: views,
				}
				workspace := &workspaceRuntime{
					server: server, store: store, sessions: []*scopeSession{session},
				}
				server.workspace = workspace

				params, err := json.Marshal(protocol.DefinitionParams{
					TextDocument: protocol.TextDocumentIdentifier{URI: uri},
					Position: protocol.Position{
						Line: 0, Character: uint32(len(prefix) + len(tag) + 2),
					},
				})
				if err != nil {
					t.Fatal(err)
				}
				response := server.Handle(context.Background(), protocol.Request{
					ID: []byte("1"), Method: protocol.MethodDefinition, Params: params,
				})
				if response.Deferred == nil {
					t.Fatal("definition request was not deferred")
				}
				result := response.Deferred()
				want := protocol.Location{
					URI: uri,
					Range: protocol.Range{
						Start: protocol.Position{Line: 1, Character: 6},
						End:   protocol.Position{Line: 1, Character: 11},
					},
				}
				if result.Error != nil || result.Result != want {
					t.Fatalf("definition = %#v, want %#v", result, want)
				}
			})
		}
	}
}

type integrationNavigationSource struct {
	template protocol.Range
	open     int
	close    int
}

func (integrationNavigationSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s integrationNavigationSource) PromptText(
	_ context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File,
		Revision:        request.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range:         integrationStaticRange(s.template),
			TemplateRange: integrationStaticRange(s.template),
			BacktickRanges: [2]staticprotocol.PromptTextRange{
				integrationStaticRange(integrationRange(0, s.open, s.open+1)),
				integrationStaticRange(integrationRange(0, s.close, s.close+1)),
			},
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
		}},
	}, nil
}

func integrationPromptTextDefinition(
	file string,
	template string,
	source protocol.Range,
) api.ProjectDefinition {
	sourceStart, sourceEnd := int(source.Start.Character)+1, int(source.End.Character)+1
	sourceLine, definitionLine := 1, 2
	definitionStart, definitionEnd := 7, 12
	return api.ProjectDefinition{
		ID: "prompt:owner", Kind: "prompt", Name: "owner",
		SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{
			File: file, StartLine: definitionLine, StartColumn: &definitionStart,
			EndLine: &definitionLine, EndColumn: &definitionEnd,
		}},
		SourceRefs: []api.ProjectSourceRef{{
			ID: "prompt:owner:source:prompt", Role: "prompt", Property: "prompt",
			Source: api.SourceLoc{
				File: file, Line: sourceLine, Column: &sourceStart,
			},
			Snippet: &api.SourceSnippet{
				Source: template,
				Range: api.SourceRange{
					File: file, StartLine: sourceLine, StartColumn: &sourceStart,
					EndLine: &sourceLine, EndColumn: &sourceEnd,
				},
			},
			Fidelity: "resolved",
			Metadata: map[string]any{"promptText": map[string]any{
				"tag": "md", "language": "markdown", "lifecycle": "static",
				"sourceKind": "owner",
			}},
		}},
	}
}

func integrationRange(line, start, end int) protocol.Range {
	return protocol.Range{
		Start: protocol.Position{Line: uint32(line), Character: uint32(start)},
		End:   protocol.Position{Line: uint32(line), Character: uint32(end)},
	}
}

func integrationStaticRange(
	source protocol.Range,
) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition(source.Start),
		End:   staticprotocol.PromptTextPosition(source.End),
	}
}
