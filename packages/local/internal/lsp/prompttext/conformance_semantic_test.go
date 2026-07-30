package prompttext

import (
	"context"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func conformanceOwnerSourceRef(
	t *testing.T,
	source string,
	file string,
	template staticprotocol.PromptTextTemplate,
	sourceRef api.ProjectSourceRef,
) api.ProjectSourceRef {
	t.Helper()
	if sourceRef.Snippet == nil {
		t.Fatal("semantic owner source ref omits its exact snippet")
	}
	sourceRange, start, end, ok := exactSourceRange(sourceRef.Snippet.Range, source)
	if !ok ||
		sourceRef.Snippet.Source != source[start:end] ||
		sourceRef.Snippet.Range.File != file ||
		editorRange(template.Range) != sourceRange {
		t.Fatalf(
			"semantic source ref = %#v, want exact Rust owner %#v",
			sourceRef,
			template.Range,
		)
	}
	return sourceRef
}

func conformanceViewProvider(
	document transient.Document,
	file string,
	definitionID string,
	sourceRef api.ProjectSourceRef,
	diagnostics []api.IndexDiagnostic,
) indexview.ViewProvider {
	generation := uint64(18)
	diagnosticIDs := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		diagnosticIDs = append(diagnosticIDs, diagnostic.ID)
	}
	index := readmodel.NewStore()
	index.ApplySnapshot("/repo", readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: definitionID, Kind: "prompt", Fidelity: "resolved",
			SourceRefs: []api.ProjectSourceRef{sourceRef},
		}},
		Diagnostics: diagnostics,
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
			DefinitionIDs: []string{definitionID}, Diagnostics: diagnosticIDs,
		}},
	})
	return indexview.NewSavedProvider(index)
}

func assertConformanceDiagnosticsAndActions(
	t *testing.T,
	controller *Controller,
	request Request,
	result DiagnosticResult,
	expected []api.IndexDiagnostic,
) {
	t.Helper()
	if len(result.Diagnostics) != len(expected) {
		t.Fatalf("diagnostics = %#v, want %d semantic conclusions", result, len(expected))
	}
	idsByCode := make(map[protocol.DiagnosticCode]string, len(expected))
	for _, diagnostic := range expected {
		idsByCode[protocol.DiagnosticCode(diagnostic.Code)] = diagnostic.ID
	}
	var titles []string
	for _, diagnostic := range result.Diagnostics {
		id := idsByCode[diagnostic.Code]
		if id == "" {
			t.Fatalf("unexpected conformance diagnostic: %#v", diagnostic)
		}
		actions := controller.Actions(context.Background(), ActionRequest{
			Request: request, DiagnosticID: id,
			DiagnosticRange: diagnostic.Range, RequestRange: diagnostic.Range,
		})
		for _, action := range actions.Actions {
			titles = append(titles, action.Title)
		}
	}
	expectedTitles := []string{
		`.join(", ")`,
		"Put sequence on its own line — changes layout",
		"Serialize with `md.json()`",
	}
	if !reflect.DeepEqual(titles, expectedTitles) {
		t.Fatalf("action titles = %#v, want %#v", titles, expectedTitles)
	}
}
