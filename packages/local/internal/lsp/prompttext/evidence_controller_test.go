package prompttext

import (
	"context"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestControllerSuppliesJoinsOnlyFromCurrentSemanticView(t *testing.T) {
	t.Parallel()

	const (
		root         = "/repo"
		documentFile = "/repo/writer.ts"
		documentText = "const value = md`${shared}`\n"
		fragmentFile = "/repo/shared.ts"
		fragmentText = "export const shared = md`Shared`\n"
	)
	ownerRange := sourceRange(documentFile, documentText, "md`${shared}`")
	expressionRange := sourceRange(documentFile, documentText, "shared")
	targetRange := sourceRange(fragmentFile, fragmentText, "md`Shared`")
	owner := promptTextSourceRef(
		"owner", "prompt", "", documentText, ownerRange,
		[]map[string]any{{
			"kind": "named-fragment", "ownerSourceRefId": "owner",
			"ownerTemplateRange":  rangeMetadata(ownerRange),
			"interpolationIndex":  float64(0),
			"expressionRange":     rangeMetadata(expressionRange),
			"targetSourceRefId":   "target",
			"targetTemplateRange": rangeMetadata(targetRange),
			"proof":               "semantic-exact",
		}},
	)
	target := promptTextSourceRef(
		"target", "prompt", "shared", fragmentText, targetRange, nil,
	)
	generation := uint64(7)
	store := readmodel.NewStore()
	store.ApplySnapshot(root, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt", SourceRefs: []api.ProjectSourceRef{owner, target},
		}},
		Sources: []api.IndexSourceFile{
			{File: documentFile, Status: "indexed", SourceHash: sourceHash(documentText)},
			{File: fragmentFile, Status: "indexed", SourceHash: sourceHash(fragmentText)},
		},
	})
	revision := transient.NewRevision(1, 1, documentText)
	document := transient.Document{
		URI: "file:///repo/writer.ts", LanguageID: "typescript",
		Version: 1, Text: documentText, Revision: revision,
	}
	analyzer := &capturePromptTextSource{}
	controller := NewController(&fixedDocumentSource{document: document})

	controller.Decorations(context.Background(), Request{
		URI: document.URI, File: documentFile, Root: root, ScopeID: root,
		SourceEpoch: 1, Analyzer: analyzer, Views: indexview.NewSavedProvider(store),
	})
	request, ok := analyzer.LastRequest()
	if !ok || len(request.Fragments) != 1 || len(request.FragmentJoins) != 1 {
		t.Fatalf("exact semantic evidence = %#v, want one fragment and join", request)
	}

	dirtyText := documentText + "// dirty\n"
	dirtyDocument := document
	dirtyDocument.Text = dirtyText
	dirtyDocument.Version++
	dirtyDocument.Revision = transient.NewRevision(1, 2, dirtyText)
	dirtyAnalyzer := &capturePromptTextSource{}
	dirtyController := NewController(&fixedDocumentSource{document: dirtyDocument})
	dirtyController.Folding(context.Background(), Request{
		URI: dirtyDocument.URI, File: documentFile, Root: root, ScopeID: root,
		SourceEpoch: 1, Analyzer: dirtyAnalyzer, Views: indexview.NewSavedProvider(store),
	})
	dirtyRequest, ok := dirtyAnalyzer.LastRequest()
	if !ok {
		t.Fatal("dirty lexical analysis was not requested")
	}
	if len(dirtyRequest.Fragments) != 0 || len(dirtyRequest.FragmentJoins) != 0 {
		t.Fatalf("dirty saved evidence = %#v, want none", dirtyRequest)
	}
}

type capturePromptTextSource struct {
	mu      sync.Mutex
	request readmodel.PromptTextRequest
	called  bool
}

func (*capturePromptTextSource) Completion(
	context.Context,
	readmodel.CompletionRequest,
) (readmodel.CompletionResult, error) {
	return readmodel.CompletionResult{}, nil
}

func (s *capturePromptTextSource) PromptText(
	_ context.Context,
	request readmodel.PromptTextRequest,
) (readmodel.PromptTextResult, error) {
	s.mu.Lock()
	s.request = request
	s.called = true
	s.mu.Unlock()
	return readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            request.File, Revision: request.Revision,
		Status:    staticprotocol.PromptTextAnalysisStatus{Kind: staticprotocol.PromptTextStatusComplete},
		Templates: []staticprotocol.PromptTextTemplate{},
	}, nil
}

func (s *capturePromptTextSource) LastRequest() (readmodel.PromptTextRequest, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.request, s.called
}
