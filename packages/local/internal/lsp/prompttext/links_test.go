package prompttext

import (
	"context"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextDocumentLinkControllerPublishesOnlyTrustedTargets(t *testing.T) {
	t.Parallel()

	const (
		root = "/repo"
		file = "/repo/src/writer.ts"
		text = "const value = md`[local](./guide.md) [web](https://example.com) " +
			"[command](command:run) [script](javascript:alert(1)) " +
			"[data](data:text/plain,x) [bad](%zz) [absolute](/etc/passwd) " +
			"[outside](../../outside.md) [dynamic](${target})`;\n"
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	revision := transient.NewRevision(1, 1, text)
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 1, Text: text,
		Revision: revision,
	}
	analysis := linkAnalysis(file, text, revision, []linkFixture{
		{label: "local", destination: "./guide.md"},
		{label: "web", destination: "https://example.com"},
		{label: "command", destination: "command:run"},
		{label: "script", destination: "javascript:alert(1)"},
		{label: "data", destination: "data:text/plain,x"},
		{label: "bad", destination: "%zz"},
		{label: "absolute", destination: "/etc/passwd"},
		{label: "outside", destination: "../../outside.md"},
	})
	controller := NewController(&fixedDocumentSource{document: document})

	result := controller.Links(context.Background(), Request{
		URI: uri, File: file, Root: root, ScopeID: root,
		SourceEpoch: 1, Analyzer: fixedTransientSource{result: analysis},
		Views: canonicalLinkViews(root, file, text, revision.SourceHash),
	})

	want := []protocol.DocumentLink{
		{
			Range:  editorRange(linkTextRange(text, "local")),
			Target: "file:///repo/src/guide.md",
		},
		{
			Range:  editorRange(linkTextRange(text, "web")),
			Target: "https://example.com",
		},
	}
	if result.Revision != revision || !equalDocumentLinks(result.Links, want) {
		t.Fatalf("links = %#v, want revision %#v and links %#v", result, revision, want)
	}
}

type linkFixture struct {
	label       string
	destination string
}

func linkAnalysis(
	file string,
	text string,
	revision transient.Revision,
	fixtures []linkFixture,
) readmodel.PromptTextResult {
	templateEnd := uint32(strings.LastIndex(text, "`") + 1)
	links := make([]staticprotocol.PromptTextLink, 0, len(fixtures))
	for index, fixture := range fixtures {
		textRange := linkTextRange(text, fixture.label)
		constructStart := strings.Index(text, "["+fixture.label+"]("+fixture.destination+")")
		destinationStart := constructStart + len(fixture.label) + 3
		constructRange := staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Character: uint32(constructStart)},
			End: staticprotocol.PromptTextPosition{
				Character: uint32(destinationStart + len(fixture.destination) + 1),
			},
		}
		destinationRange := staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Character: uint32(destinationStart)},
			End: staticprotocol.PromptTextPosition{
				Character: uint32(destinationStart + len(fixture.destination)),
			},
		}
		links = append(links, staticprotocol.PromptTextLink{
			Kind: staticprotocol.PromptTextLinkInline, Index: uint32(index), Island: 0,
			Range: constructRange, TextRange: textRange,
			DestinationRange: &destinationRange, Destination: fixture.destination,
		})
	}
	rangeAt := func(start, end uint32) staticprotocol.PromptTextRange {
		return staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Character: start},
			End:   staticprotocol.PromptTextPosition{Character: end},
		}
	}
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range: rangeAt(14, templateEnd), TagRange: rangeAt(14, 16),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			LiteralIslands: []staticprotocol.PromptTextLiteralIsland{{
				Index: 0, Range: rangeAt(17, templateEnd-1),
			}},
			Links: links,
		}},
	}
}

func linkTextRange(text, label string) staticprotocol.PromptTextRange {
	start := strings.Index(text, "["+label+"]") + 1
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Character: uint32(start)},
		End: staticprotocol.PromptTextPosition{
			Character: uint32(start + len(label)),
		},
	}
}

func canonicalLinkViews(
	root string,
	file string,
	text string,
	sourceHash string,
) indexview.ViewProvider {
	generation := uint64(1)
	endColumn := len(text) - 1
	store := readmodel.NewStore()
	store.ApplySnapshot(root, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer",
			SourceRefs: []api.ProjectSourceRef{{
				ID: "prompt:writer:source:prompt-text",
				Source: api.SourceLoc{
					File: file, Line: 1, Column: intPointer(15),
				},
				Snippet: &api.SourceSnippet{
					Source: text[14 : len(text)-2], Language: "typescript",
					Range: api.SourceRange{
						File: file, StartLine: 1, StartColumn: intPointer(15),
						EndLine: intPointer(1), EndColumn: &endColumn,
					},
				},
				Fidelity: "resolved",
				Metadata: map[string]any{"promptText": map[string]any{
					"tag": "md", "language": "markdown", "lifecycle": "static",
				}},
			}},
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: sourceHash,
		}},
	})
	return indexview.NewSavedProvider(store)
}

func equalDocumentLinks(left, right []protocol.DocumentLink) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
