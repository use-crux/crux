package parity

import (
	"encoding/json"
	"reflect"
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

func TestNormalizeProjectIndexFactsForParitySortsJsonSchemaRequiredKeys(t *testing.T) {
	left := projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{
			{
				ID:       "prompt:writer",
				Kind:     "prompt",
				Name:     "writer",
				Fidelity: "static",
				Metadata: json.RawMessage(`{"facts":{"inputSchema":{"type":"object","required":["topic","locale"]}}}`),
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
				Metadata: json.RawMessage(`{"facts":{"inputSchema":{"type":"object","required":["locale","topic"]}}}`),
			},
		},
	}

	if !FactsEqual(left, right) {
		t.Fatalf("normalized facts differed for equivalent JSON schema required order:\nleft=%s\nright=%s", mustNormalizeFacts(t, left), mustNormalizeFacts(t, right))
	}
}

func TestNormalizeProjectIndexFactsForParitySortsInputContributions(t *testing.T) {
	left := projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{inputContributionDefinition(`[
			{"field":"locale","sourceDefinitionId":"context:locale","via":"direct"},
			{"field":"brand","sourceDefinitionId":"context:brand","via":"when"}
		]`)},
	}
	right := projectindex.IndexPatchFacts{
		Definitions: []store.ProjectDefinition{inputContributionDefinition(`[
			{"field":"brand","sourceDefinitionId":"context:brand","via":"when"},
			{"field":"locale","sourceDefinitionId":"context:locale","via":"direct"}
		]`)},
	}

	if !FactsEqual(left, right) {
		t.Fatalf("normalized facts differed for equivalent input contribution order:\nleft=%s\nright=%s", mustNormalizeFacts(t, left), mustNormalizeFacts(t, right))
	}
}

func TestProductionFinalFactsForParityKeepsLintFindingsAndOmitsSourceOnlyArtifacts(t *testing.T) {
	facts := projectindex.IndexPatchFacts{
		Diagnostics: []store.IndexDiagnostic{
			{ID: "diagnostic:index:source-only", Code: "index.source_only", Severity: "warning"},
			{ID: "diagnostic:real", Code: "real", Severity: "warning"},
		},
		LintFindings: []store.IndexLintFinding{
			{ID: "lint:real", RuleID: "prompt.missing_input_schema", Severity: "warning"},
		},
		Sources: []store.IndexSourceFile{
			{File: "crux.config.ts", Status: "partial", Diagnostics: []string{"diagnostic:index:source-only"}},
			{File: "src/prompt.ts", Status: "indexed"},
		},
	}

	normalized := ProductionFinalFacts(facts)

	if len(normalized.LintFindings) != 1 {
		t.Fatalf("lint findings = %+v, want final production lint findings preserved", normalized.LintFindings)
	}
	if len(normalized.Diagnostics) != 1 || normalized.Diagnostics[0].ID != "diagnostic:real" {
		t.Fatalf("diagnostics = %+v, want only source-only artifact removed", normalized.Diagnostics)
	}
	if len(normalized.Sources) != 1 || normalized.Sources[0].File != "src/prompt.ts" {
		t.Fatalf("sources = %+v, want source-only artifact source removed", normalized.Sources)
	}
}

func TestNormalizedFactFieldsCoverBetaParitySurfaces(t *testing.T) {
	want := []string{
		"prompts",
		"contexts",
		"tools",
		"lint",
		"definitions",
		"relations",
		"sourceRefs",
		"diagnostics",
		"lintFindings",
		"ruleDescriptors",
		"sources",
		"sourceGraph",
	}
	if !reflect.DeepEqual(NormalizedFactFields, want) {
		t.Fatalf("normalized fact fields = %#v, want %#v", NormalizedFactFields, want)
	}
}

func inputContributionDefinition(contributions string) store.ProjectDefinition {
	return store.ProjectDefinition{
		ID:       "prompt:writer",
		Kind:     "prompt",
		Name:     "writer",
		Fidelity: "static",
		Metadata: json.RawMessage(`{"facts":{"inputContributions":` + contributions + `}}`),
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
