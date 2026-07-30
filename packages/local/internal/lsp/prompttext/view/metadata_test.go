package view

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestNormalizePromptTextRefRequiresCanonicalPromptOrSystemProperty(t *testing.T) {
	raw := promptTextViewDefinition("/repo/source.ts").SourceRefs[0]
	raw.Role = "description"
	raw.Property = "description"

	if _, ok := normalizePromptTextRef(
		SourceRefKey{DefinitionID: "prompt:owner", SourceRefID: raw.ID},
		raw,
		"/repo",
	); ok {
		t.Fatal("non-prompt/system source ref was accepted as PromptText")
	}
}

func TestNormalizePromptTextRefRequiresCanonicalMetadataTag(t *testing.T) {
	raw := promptTextViewDefinition("/repo/source.ts").SourceRefs[0]
	raw.Metadata["promptText"].(map[string]any)["tag"] = "lookalike"

	if _, ok := normalizePromptTextRef(
		SourceRefKey{DefinitionID: "prompt:owner", SourceRefID: raw.ID},
		raw,
		"/repo",
	); ok {
		t.Fatal("foreign normalized tag was accepted as canonical PromptText")
	}
}

func TestNormalizePromptTextRefRequiresConsistentSourceKind(t *testing.T) {
	tests := []struct {
		name       string
		sourceKind any
		present    bool
		symbol     string
		want       PromptTextSourceKind
		ok         bool
	}{
		{
			name: "owner", sourceKind: "owner", present: true,
			want: PromptTextSourceOwner, ok: true,
		},
		{
			name: "named", sourceKind: "named-fragment", present: true, symbol: "shared",
			want: PromptTextSourceNamedFragment, ok: true,
		},
		{
			name: "anonymous", sourceKind: "anonymous-fragment", present: true,
			want: PromptTextSourceAnonymousFragment, ok: true,
		},
		{name: "missing"},
		{name: "null", present: true},
		{name: "unknown", sourceKind: "fragment", present: true},
		{name: "named without symbol", sourceKind: "named-fragment", present: true},
		{name: "owner with symbol", sourceKind: "owner", present: true, symbol: "shared"},
		{
			name: "anonymous with symbol", sourceKind: "anonymous-fragment", present: true,
			symbol: "shared",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			raw := promptTextViewDefinition("/repo/source.ts").SourceRefs[0]
			promptText := raw.Metadata["promptText"].(map[string]any)
			delete(promptText, "sourceKind")
			if test.present {
				promptText["sourceKind"] = test.sourceKind
			}
			raw.Symbol = test.symbol

			ref, ok := normalizePromptTextRef(
				SourceRefKey{DefinitionID: "prompt:owner", SourceRefID: raw.ID},
				raw,
				"/repo",
			)

			if ok != test.ok || ok && ref.SourceKind != test.want {
				t.Fatalf("normalize = %#v, %v; want kind %q, ok %v", ref, ok, test.want, test.ok)
			}
		})
	}
}

func TestNormalizeSourceRefsRequiresNamedTargetClassification(t *testing.T) {
	const file = "/repo/source.ts"
	for _, test := range []struct {
		sourceKind string
		symbol     string
		wantJoins  int
	}{
		{sourceKind: "named-fragment", symbol: "shared", wantJoins: 1},
		{sourceKind: "anonymous-fragment"},
	} {
		t.Run(test.sourceKind, func(t *testing.T) {
			owner := promptTextViewDefinition(file).SourceRefs[0]
			owner.ID = "owner"
			owner.Metadata["fragment"] = true
			target := promptTextViewDefinition(file).SourceRefs[0]
			target.ID = "target"
			target.Symbol = test.symbol
			target.Metadata["promptText"].(map[string]any)["sourceKind"] = test.sourceKind
			target.Snippet = &api.SourceSnippet{
				Source: "md`shared`",
				Range: api.SourceRange{
					File: file, StartLine: 3, StartColumn: metadataInt(1),
					EndLine: metadataInt(3), EndColumn: metadataInt(12),
				},
			}
			owner.Metadata["promptText"].(map[string]any)["fragmentJoins"] = []map[string]any{{
				"kind":               "named-fragment",
				"ownerSourceRefId":   "owner",
				"ownerTemplateRange": owner.Snippet.Range,
				"interpolationIndex": 0,
				"expressionRange": api.SourceRange{
					File: file, StartLine: 2, StartColumn: metadataInt(18),
					EndLine: metadataInt(2), EndColumn: metadataInt(23),
				},
				"targetSourceRefId":   "target",
				"targetTemplateRange": target.Snippet.Range,
				"proof":               "semantic-exact",
			}}
			definition := api.ProjectDefinition{
				ID: "prompt:owner", SourceRefs: []api.ProjectSourceRef{owner, target},
			}

			refs, joins, _ := normalizeSourceRefs(definition, "/repo")

			if len(refs) != 2 || refs[0].SourceKind != PromptTextSourceOwner {
				t.Fatalf("normalized refs = %#v, want legacy-independent owner and target", refs)
			}
			if len(joins) != test.wantJoins {
				t.Fatalf("joins = %#v, want %d", joins, test.wantJoins)
			}
		})
	}
}

func TestPromptTextRefSignatureIncludesSourceKind(t *testing.T) {
	owner := PromptTextSourceRef{SourceKind: PromptTextSourceOwner}
	anonymous := PromptTextSourceRef{SourceKind: PromptTextSourceAnonymousFragment}
	if refSignature(owner) == refSignature(anonymous) {
		t.Fatal("source-kind change did not invalidate the stable signature")
	}
}

func TestNormalizeRefactorTargetAcceptsCompilerProvenCanonicalBindings(t *testing.T) {
	for _, binding := range []RefactorBinding{
		{Kind: "identifier", Expression: "md"},
		{Kind: "identifier", Expression: "text"},
		{Kind: "identifier", Expression: "render"},
		{Kind: "namespace-access", Expression: "core.md"},
	} {
		t.Run(binding.Expression, func(t *testing.T) {
			raw := promptTextViewDefinition("/repo/source.ts").SourceRefs[0]
			delete(raw.Metadata, "promptText")
			raw.Metadata["promptTextRefactor"] = map[string]any{
				"kind": "ordinary-string-to-md", "proof": "semantic-exact",
				"lifecycle": "static", "target": "md",
				"binding": map[string]any{
					"kind": binding.Kind, "expression": binding.Expression,
				},
			}

			target, ok := normalizeRefactorTarget(
				SourceRefKey{
					DefinitionID: "prompt:owner", SourceRefID: raw.ID,
				},
				raw,
				"/repo",
			)

			if !ok || target.Binding != binding {
				t.Fatalf("normalized target = %#v, %v", target, ok)
			}
		})
	}
}

func TestNormalizeRefactorTargetRejectsPresentNullPromptTextMetadata(t *testing.T) {
	raw := promptTextViewDefinition("/repo/source.ts").SourceRefs[0]
	raw.Metadata["promptText"] = nil
	raw.Metadata["promptTextRefactor"] = map[string]any{
		"kind": "ordinary-string-to-md", "proof": "semantic-exact",
		"lifecycle": "static", "target": "md",
		"binding": map[string]any{
			"kind": "identifier", "expression": "md",
		},
	}

	if _, ok := normalizeRefactorTarget(
		SourceRefKey{DefinitionID: "prompt:owner", SourceRefID: raw.ID},
		raw,
		"/repo",
	); ok {
		t.Fatal("refactor target accepted a present null promptText field")
	}
}

func TestNormalizeSourceRefsRejectsDuplicateRawIdentityAcrossCategories(t *testing.T) {
	const file = "/repo/source.ts"
	for _, test := range []struct {
		name      string
		duplicate func(api.ProjectSourceRef) api.ProjectSourceRef
	}{
		{
			name: "refactor",
			duplicate: func(raw api.ProjectSourceRef) api.ProjectSourceRef {
				raw.Metadata = map[string]any{
					"promptTextRefactor": map[string]any{
						"kind": "ordinary-string-to-md", "proof": "semantic-exact",
						"lifecycle": "static", "target": "md",
						"binding": map[string]any{
							"kind": "identifier", "expression": "md",
						},
					},
				}
				return raw
			},
		},
		{
			name: "unrelated",
			duplicate: func(raw api.ProjectSourceRef) api.ProjectSourceRef {
				raw.Metadata = map[string]any{"extensions": map[string]any{"test": true}}
				return raw
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			definition := promptTextViewDefinition(file)
			owner := definition.SourceRefs[0]
			definition.SourceRefs = []api.ProjectSourceRef{
				owner,
				test.duplicate(owner),
			}

			refs, joins, refactors := normalizeSourceRefs(definition, "/repo")

			if len(refs) != 0 || len(joins) != 0 || len(refactors) != 0 {
				t.Fatalf(
					"duplicate raw identity retained refs=%#v joins=%#v refactors=%#v",
					refs,
					joins,
					refactors,
				)
			}
		})
	}
}

func metadataInt(value int) *int { return &value }
