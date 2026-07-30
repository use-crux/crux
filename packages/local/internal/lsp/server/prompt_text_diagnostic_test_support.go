package server

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
)

type promptTextDiagnosticRecorder struct {
	mu     sync.Mutex
	values []protocol.PublishDiagnosticsParams
	wake   chan struct{}
}

func newPromptTextDiagnosticRecorder() *promptTextDiagnosticRecorder {
	return &promptTextDiagnosticRecorder{wake: make(chan struct{}, 32)}
}

func (r *promptTextDiagnosticRecorder) publish(
	value protocol.PublishDiagnosticsParams,
) {
	r.mu.Lock()
	r.values = append(r.values, value)
	r.mu.Unlock()
	r.wake <- struct{}{}
}

func (r *promptTextDiagnosticRecorder) latest(
	t *testing.T,
) protocol.PublishDiagnosticsParams {
	t.Helper()
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.values) == 0 {
		t.Fatal("no diagnostic publication")
	}
	return r.values[len(r.values)-1]
}

func (r *promptTextDiagnosticRecorder) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.values)
}

func (r *promptTextDiagnosticRecorder) waitFor(
	t *testing.T,
	match func(protocol.PublishDiagnosticsParams) bool,
) protocol.PublishDiagnosticsParams {
	t.Helper()
	value, _ := r.waitForAfter(t, 0, match)
	return value
}

func (r *promptTextDiagnosticRecorder) waitForAfter(
	t *testing.T,
	start int,
	match func(protocol.PublishDiagnosticsParams) bool,
) (protocol.PublishDiagnosticsParams, int) {
	t.Helper()
	deadline := time.After(time.Second)
	for {
		r.mu.Lock()
		for index := start; index < len(r.values); index++ {
			value := r.values[index]
			if match(value) {
				r.mu.Unlock()
				return value, index
			}
		}
		r.mu.Unlock()
		select {
		case <-r.wake:
		case <-deadline:
			t.Fatalf("diagnostic publications = %#v, want matching value", r.values)
		}
	}
}

func promptTextDiagnosticSnapshot(text string) readmodel.Snapshot {
	const id = "prompt-text:0000000000000000000000000000000000000000000000000000000000000001"
	generation := uint64(1)
	startColumn, endLine, endColumn, expressionColumn := 15, 1, 32, 26
	evidence, _ := json.Marshal(map[string]any{
		"kind": "prompt-text", "sourceRefId": "source-ref",
		"interpolationIndex": 0, "proof": "semantic-exact",
		"cause": map[string]any{
			"kind": "invalid-interpolation", "runtimeKinds": []string{"boolean"},
			"mdJsonApplicable": true,
		},
	})
	return readmodel.Snapshot{
		Generation: &generation,
		Indexing: &api.ProjectIndexingStatus{
			Semantic: api.IndexIndexingSemanticStatus{Status: "ready"},
		},
		Definitions: []api.ProjectDefinition{{
			ID: "prompt", Kind: "prompt",
			SourceRefs: []api.ProjectSourceRef{{
				ID: "source-ref", Role: "prompt", Property: "prompt",
				Source: api.SourceLoc{File: "/repo/source.ts", Line: 1, Column: &startColumn},
				Snippet: &api.SourceSnippet{
					Source: "md`Hello ${true}`", Language: "typescript",
					Range: api.SourceRange{
						File: "/repo/source.ts", StartLine: 1,
						StartColumn: &startColumn, EndLine: &endLine, EndColumn: &endColumn,
					},
				},
				Fidelity: "resolved", Metadata: map[string]any{
					"promptText": map[string]any{
						"tag": "md", "language": "markdown", "lifecycle": "static",
						"sourceKind": "owner",
					},
				},
			}},
		}},
		Diagnostics: []api.IndexDiagnostic{{
			ID: id, Severity: "error", Code: "CRUX_PROMPT_TEXT_INVALID_INTERPOLATION",
			Message: "PromptText interpolation 0 is always invalid (boolean). Use a string, finite number, PromptText fragment, false, null, undefined, or a supported sequence.",
			Source: &api.SourceLoc{
				File: "/repo/source.ts", Line: 1, Column: &expressionColumn,
			},
			RelatedDefinitionIDs: []string{"prompt"}, Evidence: evidence,
		}},
		Sources: []api.IndexSourceFile{{
			File: "/repo/source.ts", Status: "indexed",
			SourceHash:  transient.NewRevision(1, 1, text).SourceHash,
			Diagnostics: []string{id},
		}},
	}
}
