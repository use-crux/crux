package server

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

func TestPromptRoleNamedFragmentNavigatesWithoutLegacyFragmentMarker(
	t *testing.T,
) {
	const (
		targetLine = "const shared = md`shared`;"
		ownerLine  = "export const writer = prompt({ id: 'owner', prompt: md`before ${shared} after` });"
	)
	source := targetLine + "\n" + ownerLine + "\n"
	root := t.TempDir()
	file := navigationTestFile(t, root, "fragments.ts", source)
	uri := protocol.DocumentURI(mapping.FileURI(root, file))
	targetRange := integrationRange(
		0,
		strings.Index(targetLine, "md`"),
		strings.Index(targetLine, "md`")+len("md`shared`"),
	)
	ownerRange := integrationRange(
		1,
		strings.Index(ownerLine, "md`"),
		strings.Index(ownerLine, "md`")+len("md`before ${shared} after`"),
	)
	expressionStart := strings.Index(ownerLine, "${shared}") + 2
	expressionRange := integrationRange(
		1,
		expressionStart,
		expressionStart+len("shared"),
	)
	definitionRange := integrationRange(
		1,
		strings.Index(ownerLine, "writer"),
		strings.Index(ownerLine, "writer")+len("writer"),
	)
	definition := fragmentIntegrationDefinition(
		file,
		targetLine[targetRange.Start.Character:targetRange.End.Character],
		targetRange,
		ownerLine[ownerRange.Start.Character:ownerRange.End.Character],
		ownerRange,
		expressionRange,
		definitionRange,
	)
	generation := uint64(1)
	store := readmodel.NewStore()
	store.ApplySnapshot("scope", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{definition},
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
	views := promptview.NewProvider(saved, promptview.Options{Root: root})
	revision := promptTextViewRevision(document)
	if !views.Open(promptview.Request{
		ScopeID: "scope", File: file, Document: &revision,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	}) {
		t.Fatal("exact transformed view was not established")
	}
	transientSource := integrationNavigationSource{
		template: targetRange,
		open:     int(targetRange.Start.Character) + len("md"),
		close:    int(targetRange.End.Character) - 1,
	}
	for _, mode := range []readmodel.Mode{
		readmodel.ModeOwn,
		readmodel.ModeAttached,
	} {
		t.Run(string(mode), func(t *testing.T) {
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
					Line: 0, Character: targetRange.Start.Character + 4,
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			response := server.Handle(context.Background(), protocol.Request{
				ID: []byte("2"), Method: protocol.MethodDefinition, Params: params,
			})
			if response.Deferred == nil {
				t.Fatal("definition request was not deferred")
			}
			result := response.Deferred()
			want := protocol.Location{URI: uri, Range: definitionRange}
			if result.Error != nil || result.Result != want {
				t.Fatalf("named-fragment definition = %#v, want %#v", result, want)
			}
		})
	}
}

func fragmentIntegrationDefinition(
	file, targetSource string,
	targetRange protocol.Range,
	ownerSource string,
	ownerRange, expressionRange, definitionRange protocol.Range,
) api.ProjectDefinition {
	targetID := "prompt:owner:source:prompt:target"
	ownerID := "prompt:owner:source:prompt:owner"
	target := integrationSourceRef(
		file, targetID, "shared", "named-fragment", targetSource, targetRange,
	)
	owner := integrationSourceRef(
		file, ownerID, "", "owner", ownerSource, ownerRange,
	)
	owner.Metadata["promptText"].(map[string]any)["fragmentJoins"] =
		[]map[string]any{{
			"kind":               "named-fragment",
			"ownerSourceRefId":   ownerID,
			"ownerTemplateRange": integrationAPIRange(file, ownerRange),
			"interpolationIndex": 0,
			"expressionRange":    integrationAPIRange(file, expressionRange),
			"targetSourceRefId":  targetID,
			"targetTemplateRange": integrationAPIRange(
				file,
				targetRange,
			),
			"proof": "semantic-exact",
		}}
	return api.ProjectDefinition{
		ID: "prompt:owner", Kind: "prompt", Name: "owner",
		SourceSnippet: &api.SourceSnippet{
			Range: integrationAPIRange(file, definitionRange),
		},
		SourceRefs: []api.ProjectSourceRef{owner, target},
	}
}

func integrationSourceRef(
	file, id, symbol, sourceKind, source string,
	sourceRange protocol.Range,
) api.ProjectSourceRef {
	apiRange := integrationAPIRange(file, sourceRange)
	return api.ProjectSourceRef{
		ID: id, Role: "prompt", Property: "prompt", Symbol: symbol,
		Source: api.SourceLoc{
			File: file, Line: apiRange.StartLine, Column: apiRange.StartColumn,
		},
		Snippet:  &api.SourceSnippet{Source: source, Range: apiRange},
		Fidelity: "resolved",
		Metadata: map[string]any{"promptText": map[string]any{
			"tag": "md", "language": "markdown", "lifecycle": "static",
			"sourceKind": sourceKind,
		}},
	}
}

func integrationAPIRange(
	file string,
	source protocol.Range,
) api.SourceRange {
	start, end := int(source.Start.Character)+1, int(source.End.Character)+1
	endLine := int(source.End.Line) + 1
	return api.SourceRange{
		File: file, StartLine: int(source.Start.Line) + 1, StartColumn: &start,
		EndLine: &endLine, EndColumn: &end,
	}
}
