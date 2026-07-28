package prompttext

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestPromptTextInvalidActionRegeneratesVersionedSerializationEdit(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Actions(context.Background(), ActionRequest{
		Request:         fixture.request,
		DiagnosticID:    fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})

	if result.Revision != fixture.document.Revision ||
		result.ViewStamp != fixture.viewStamp ||
		len(result.Actions) != 1 {
		t.Fatalf("action result = %#v, want one exact current action", result)
	}
	action := result.Actions[0]
	if action.Title != "Serialize with `md.json()`" ||
		action.Kind != protocol.CodeActionQuickFix ||
		len(action.Diagnostics) != 1 ||
		action.Diagnostics[0].Range != fixture.expressionRange ||
		action.Edit == nil ||
		len(action.Edit.Changes) != 0 ||
		len(action.Edit.DocumentChanges) != 1 ||
		action.Command != nil {
		t.Fatalf("action = %#v, want eager narrow versioned quickfix", action)
	}
	documentEdit := action.Edit.DocumentChanges[0]
	if documentEdit.TextDocument.URI != fixture.document.URI ||
		documentEdit.TextDocument.Version != 7 ||
		len(documentEdit.Edits) != 1 ||
		documentEdit.Edits[0].Range != fixture.expressionRange ||
		documentEdit.Edits[0].NewText != "(text).json(true)" {
		t.Fatalf("document edit = %#v, want exact alias serialization", documentEdit)
	}
}

func TestPromptTextActionRejectsMismatchedEchoedRange(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: protocol.Range{},
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 0 {
		t.Fatalf("mismatched range actions = %#v, want none", result.Actions)
	}
}

func TestPromptTextJSONSerializationDiagnosticHasNoAction(t *testing.T) {
	t.Parallel()

	action, ok := serializationCodeAction(diagnosticMatch{
		diagnostic: protocol.Diagnostic{Range: protocol.Range{}},
		evidence: store.PromptTextDiagnosticEvidence{
			Cause: store.PromptTextDiagnosticCause{
				Kind: "json-serialization", Reason: "undefined-result",
			},
		},
		tagExpression: "md", expressionText: "md.json(undefined)",
	}, transient.Document{
		URI:      "file:///repo/source.ts",
		Revision: transient.Revision{OpenEpoch: 1, Version: 1, SourceHash: "hash"},
	})
	if ok || action.Edit != nil {
		t.Fatalf("JSON serialization action = %#v, %v; want none", action, ok)
	}
}

func TestPromptTextInvalidActionPreservesExactLocalSyntax(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name       string
		tag        string
		expression string
		want       string
	}{
		{
			name: "direct",
			tag:  "md", expression: "value",
			want: "(md).json(value)",
		},
		{
			name: "namespace and comments",
			tag:  "core /* binding */ .md", expression: "value /* once */",
			want: "(core /* binding */ .md).json(value /* once */)",
		},
		{
			name:       "parenthesized multiline CRLF and Unicode",
			tag:        "(text)",
			expression: "(\r\n  payload satisfies { label: \"🦀\" }\r\n)",
			want:       "((text)).json((\r\n  payload satisfies { label: \"🦀\" }\r\n))",
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			action, ok := serializationCodeAction(diagnosticMatch{
				diagnostic: protocol.Diagnostic{Range: protocol.Range{}},
				evidence: store.PromptTextDiagnosticEvidence{
					Cause: store.PromptTextDiagnosticCause{
						Kind: "invalid-interpolation", MDJSONApplicable: true,
					},
				},
				tagExpression: test.tag, expressionText: test.expression,
			}, transient.Document{
				URI: "file:///repo/source.ts",
				Revision: transient.Revision{
					OpenEpoch: 1, Version: 2, SourceHash: "hash",
				},
			})
			if !ok || action.Edit.DocumentChanges[0].Edits[0].NewText != test.want {
				t.Fatalf("action = %#v, want exact syntax %q", action, test.want)
			}
			if strings.Count(test.want, test.tag) != 1 ||
				strings.Count(test.want, test.expression) != 1 {
				t.Fatalf("edit %q does not preserve single evaluation", test.want)
			}
		})
	}
}

func TestPromptTextActionWireContainsOnlyVersionedDocumentEdit(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	data, err := json.Marshal(result.Actions[0])
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(data, &wire); err != nil {
		t.Fatal(err)
	}
	assertExactKeys(t, wire, "diagnostics", "edit", "kind", "title")
	edit := wire["edit"].(map[string]any)
	assertExactKeys(t, edit, "documentChanges")
	changes := edit["documentChanges"].([]any)
	if len(changes) != 1 {
		t.Fatalf("documentChanges = %#v, want one", changes)
	}
	documentEdit := changes[0].(map[string]any)
	assertExactKeys(t, documentEdit, "edits", "textDocument")
	document := documentEdit["textDocument"].(map[string]any)
	assertExactKeys(t, document, "uri", "version")
	edits := documentEdit["edits"].([]any)
	if len(edits) != 1 {
		t.Fatalf("edits = %#v, want one", edits)
	}
	assertExactKeys(t, edits[0].(map[string]any), "newText", "range")
}

func TestPromptTextInvalidActionHasNoProhibitedAlternative(t *testing.T) {
	t.Parallel()

	fixture := promptTextInvalidFixture(t)
	controller := NewController(
		&fixedDocumentSource{document: fixture.document},
	)
	result := controller.Actions(context.Background(), ActionRequest{
		Request: fixture.request, DiagnosticID: fixture.diagnosticID,
		DiagnosticRange: fixture.expressionRange,
		RequestRange:    fixture.expressionRange,
	})
	if len(result.Actions) != 1 {
		t.Fatalf("actions = %#v, want only serialization", result.Actions)
	}
	title := strings.ToLower(result.Actions[0].Title)
	for _, prohibited := range []string{
		"encoding", "escape", "escapexml", "raw", "safe",
		"sanitize", "suppress", "trust", "xml",
	} {
		if strings.Contains(title, prohibited) {
			t.Fatalf("prohibited %q action title = %q", prohibited, title)
		}
	}
}

func assertExactKeys(t *testing.T, value map[string]any, want ...string) {
	t.Helper()
	if len(value) != len(want) {
		t.Fatalf("keys = %v, want %v", mapKeys(value), want)
	}
	for _, key := range want {
		if _, ok := value[key]; !ok {
			t.Fatalf("keys = %v, missing %q", mapKeys(value), key)
		}
	}
}

func mapKeys(value map[string]any) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	return keys
}
