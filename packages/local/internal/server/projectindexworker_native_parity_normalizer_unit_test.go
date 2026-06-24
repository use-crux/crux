package server

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestNormalizeProjectIndexFactsForParityIgnoresFactOrdering(t *testing.T) {
	left := devtools.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "static"},
			{ID: "context:brand", Kind: "context", Name: "brand", Fidelity: "static"},
		},
		Relations: []store.ProjectRelation{
			{ID: "prompt:writer->context:brand", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "static"},
		},
		SourceRefs: []devtools.IndexSourceRefFact{
			{
				DefinitionID: "prompt:writer",
				Ref: store.ProjectSourceRef{
					ID:     "prompt:writer:config",
					Role:   "config",
					Source: store.SourceLoc{File: `src\writer.ts`, Line: 2, Column: intPtr(4)},
				},
			},
		},
	}
	right := devtools.IndexPatchFacts{
		SourceRefs: []devtools.IndexSourceRefFact{
			{
				DefinitionID: "prompt:writer",
				Ref: store.ProjectSourceRef{
					ID:     "prompt:writer:config",
					Role:   "config",
					Source: store.SourceLoc{File: "src/writer.ts", Line: 2, Column: intPtr(4)},
				},
			},
		},
		Relations: []store.ProjectRelation{
			{ID: "prompt:writer->context:brand", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "static"},
		},
		Definitions: []store.ProjectDefinition{
			{ID: "context:brand", Kind: "context", Name: "brand", Fidelity: "static"},
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "static"},
		},
	}

	if !normalizedProjectIndexFactsEqual(left, right) {
		t.Fatalf("normalized facts differed for equivalent fact ordering:\nleft=%s\nright=%s", mustNormalizeFacts(t, left), mustNormalizeFacts(t, right))
	}
}

func TestNormalizeProjectIndexFactsForParityKeepsSemanticFields(t *testing.T) {
	left := devtools.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "static",
				Metadata: json.RawMessage(`{"facts":{"kind":"prompt","hasPrompt":true}}`),
			},
		},
	}
	right := devtools.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "static",
				Metadata: json.RawMessage(`{"facts":{"kind":"prompt","hasPrompt":false}}`),
			},
		},
	}

	if normalizedProjectIndexFactsEqual(left, right) {
		t.Fatalf("normalized facts matched after a semantic metadata change:\n%s", mustNormalizeFacts(t, left))
	}
}

func TestNormalizeProjectIndexFactsForParityKeepsMetadataArrayOrdering(t *testing.T) {
	left := devtools.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "static",
				Metadata: json.RawMessage(`{"facts":{"tags":["alpha","beta"]}}`),
			},
		},
	}
	right := devtools.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "static",
				Metadata: json.RawMessage(`{"facts":{"tags":["beta","alpha"]}}`),
			},
		},
	}

	if normalizedProjectIndexFactsEqual(left, right) {
		t.Fatalf("normalized facts matched after metadata array order changed:\n%s", mustNormalizeFacts(t, left))
	}
}

func mustNormalizeFacts(t *testing.T, facts devtools.IndexPatchFacts) string {
	t.Helper()
	normalized, err := normalizeProjectIndexFactsForParity(facts)
	if err != nil {
		t.Fatalf("normalize facts: %v", err)
	}
	return normalized
}

func intPtr(value int) *int {
	return &value
}
