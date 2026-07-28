package prompttext

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestPromptTextInvalidDiagnosticUsesExactExpressionAndMinimalData(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Diagnostics(context.Background(), fixture.request)

	if result.Revision != fixture.document.Revision ||
		result.ViewStamp != fixture.viewStamp ||
		len(result.Diagnostics) != 1 {
		t.Fatalf("diagnostic result = %#v, want exact stamped diagnostic", result)
	}
	diagnostic := result.Diagnostics[0]
	if diagnostic.Range != fixture.expressionRange ||
		diagnostic.Severity != protocol.SeverityError ||
		diagnostic.Code != "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION" ||
		diagnostic.Source != "crux" ||
		diagnostic.Message != fixture.message {
		t.Fatalf("diagnostic = %#v, want exact invalid interpolation", diagnostic)
	}
	var data map[string]string
	if json.Unmarshal(diagnostic.Data, &data) != nil ||
		len(data) != 2 ||
		data["kind"] != "prompt-text" ||
		data["id"] != fixture.diagnosticID {
		t.Fatalf("diagnostic data = %s, want strict minimal locator", diagnostic.Data)
	}
	if len(diagnostic.RelatedInformation) != 0 || len(diagnostic.Tags) != 0 ||
		diagnostic.CodeDescription != nil {
		t.Fatalf("diagnostic exposed optional semantic fields: %#v", diagnostic)
	}
}

func TestPromptTextDiagnosticRangeMappingPreservesCRLFAndUnicode(t *testing.T) {
	t.Parallel()

	const text = "🦀\r\n  value🦀\r\n"
	expression := staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{Line: 1, Character: 2},
		End:   staticprotocol.PromptTextPosition{Line: 1, Character: 9},
	}
	mapped, ok := textForPromptRange(text, expression)
	if !ok || mapped != "value🦀" {
		t.Fatalf("mapped expression = %q, %v; want exact Unicode bytes", mapped, ok)
	}
	if editorRange(expression) != (protocol.Range{
		Start: protocol.Position{Line: 1, Character: 2},
		End:   protocol.Position{Line: 1, Character: 9},
	}) {
		t.Fatalf("editor range = %#v, want exact UTF-16 range", editorRange(expression))
	}
}

type invalidDiagnosticFixture struct {
	document        transient.Document
	request         Request
	analysis        readmodel.PromptTextResult
	viewStamp       indexview.ViewStamp
	expressionRange protocol.Range
	diagnosticID    string
	message         string
}

func promptTextInvalidFixture(t *testing.T) invalidDiagnosticFixture {
	t.Helper()
	const (
		root   = "/repo"
		file   = "/repo/src/writer.ts"
		source = "import { md as text } from \"@use-crux/core\"\n" +
			"const value = text`Hello ${true}`\n"
		diagnosticID = "prompt-text:0000000000000000000000000000000000000000000000000000000000000001"
		message      = "PromptText interpolation 0 is always invalid (boolean). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence."
	)
	uri := protocol.DocumentURI("file:///repo/src/writer.ts")
	document := transient.Document{
		URI: uri, LanguageID: "typescript", Version: 7, Text: source,
		Revision: transient.NewRevision(3, 7, source),
	}
	templateSource := sourceRange(file, source, "text`Hello ${true}`")
	tagSource := sourceRange(file, source, "text")
	expressionSource := sourceRange(file, source, "true")
	barrierSource := sourceRange(file, source, "${true}")
	analysis := readmodel.PromptTextResult{
		ProtocolVersion: staticprotocol.PromptTextProtocolVersion,
		File:            file,
		Revision:        document.Revision,
		Status: staticprotocol.PromptTextAnalysisStatus{
			Kind: staticprotocol.PromptTextStatusComplete,
		},
		Templates: []staticprotocol.PromptTextTemplate{{
			Range:         sourceProtocolRange(templateSource),
			TagRange:      sourceProtocolRange(tagSource),
			TemplateRange: sourceProtocolRange(templateSource),
			Status: staticprotocol.PromptTextAnalysisStatus{
				Kind: staticprotocol.PromptTextStatusComplete,
			},
			InterpolationBarriers: []staticprotocol.PromptTextInterpolationBarrier{{
				Index: 0, Range: sourceProtocolRange(barrierSource),
				ExpressionRange: sourceProtocolRange(expressionSource),
			}},
		}},
	}
	evidence, err := json.Marshal(map[string]any{
		"kind":               "prompt-text",
		"sourceRefId":        "prompt:writer:source:prompt",
		"interpolationIndex": 0,
		"proof":              "semantic-exact",
		"cause": map[string]any{
			"kind": "invalid-interpolation", "runtimeKinds": []string{"boolean"},
			"mdJsonApplicable": true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	generation := uint64(4)
	store := readmodel.NewStore()
	store.ApplySnapshot(root, readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt:writer", Kind: "prompt",
			SourceRefs: []api.ProjectSourceRef{{
				ID: "prompt:writer:source:prompt", Role: "prompt", Property: "prompt",
				Source: api.SourceLoc{
					File: file, Line: templateSource.StartLine,
					Column: templateSource.StartColumn,
				},
				Snippet: &api.SourceSnippet{
					Source: "text`Hello ${true}`", Language: "typescript",
					Range: templateSource,
				},
				Fidelity: "resolved",
				Metadata: map[string]any{"promptText": map[string]any{
					"tag": "md", "language": "markdown", "lifecycle": "static",
					"sourceKind": "owner",
				}},
			}},
		}},
		Diagnostics: []api.IndexDiagnostic{{
			ID: diagnosticID, Severity: "error",
			Code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION", Message: message,
			Source: &api.SourceLoc{
				File: file, Line: expressionSource.StartLine,
				Column: expressionSource.StartColumn,
			},
			RelatedDefinitionIDs: []string{"prompt:writer"},
			Evidence:             evidence,
		}},
		Sources: []api.IndexSourceFile{{
			File: file, Status: "indexed", SourceHash: document.Revision.SourceHash,
			Diagnostics: []string{diagnosticID},
		}},
	})
	views := indexview.NewSavedProvider(store)
	selection := views.BestAvailableView(indexview.ViewRequest{
		ScopeID: root, File: file,
		Document: &indexview.DocumentRevision{
			OpenEpoch: 3, Version: 7, SourceHash: document.Revision.SourceHash,
		},
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.RequireCurrent,
	})
	return invalidDiagnosticFixture{
		document: document,
		request: Request{
			URI: uri, File: file, Root: root, ScopeID: root, SourceEpoch: 2,
			Analyzer: fixedTransientSource{result: analysis}, Views: views,
		},
		analysis:        analysis,
		viewStamp:       selection.View.Stamp,
		expressionRange: editorRange(sourceProtocolRange(expressionSource)),
		diagnosticID:    diagnosticID,
		message:         message,
	}
}
