package parity

import (
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestNormalizeProjectIndexFactsForParityIgnoresFactOrdering(t *testing.T) {
	left := projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:writer", Kind: "prompt", Name: "writer", Fidelity: "static"},
			{ID: "context:brand", Kind: "context", Name: "brand", Fidelity: "static"},
		},
		Relations: []store.ProjectRelation{
			{ID: "prompt:writer->context:brand", Type: "prompt.uses_context", From: "prompt:writer", To: "context:brand", Fidelity: "static"},
		},
		SourceRefs: []projectindex.IndexSourceRefFact{
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
	right := projectindex.IndexPatchFacts{
		SourceRefs: []projectindex.IndexSourceRefFact{
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

	if !FactsEqual(left, right) {
		t.Fatalf("normalized facts differed for equivalent fact ordering:\nleft=%s\nright=%s", mustNormalizeFacts(t, left), mustNormalizeFacts(t, right))
	}
}

func TestNormalizeProjectIndexFactsForParityKeepsSemanticFields(t *testing.T) {
	left := projectindex.IndexPatchFacts{
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
	right := projectindex.IndexPatchFacts{
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

	if FactsEqual(left, right) {
		t.Fatalf("normalized facts matched after a semantic metadata change:\n%s", mustNormalizeFacts(t, left))
	}
}

func TestNormalizeProjectIndexFactsForParityKeepsMetadataArrayOrdering(t *testing.T) {
	left := projectindex.IndexPatchFacts{
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
	right := projectindex.IndexPatchFacts{
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

	if FactsEqual(left, right) {
		t.Fatalf("normalized facts matched after metadata array order changed:\n%s", mustNormalizeFacts(t, left))
	}
}

func mustNormalizeFacts(t *testing.T, facts projectindex.IndexPatchFacts) string {
	t.Helper()
	normalized, err := NormalizeFacts(facts)
	if err != nil {
		t.Fatalf("normalize facts: %v", err)
	}
	return normalized
}

func intPtr(value int) *int {
	return &value
}
