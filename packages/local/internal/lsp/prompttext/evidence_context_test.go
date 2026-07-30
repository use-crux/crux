package prompttext

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestSemanticJoinRequiresOneExactOwningContext(t *testing.T) {
	t.Parallel()

	source := api.SourceRange{
		File: "/repo/writer.ts", StartLine: 1, StartColumn: intPointer(1),
		EndLine: intPointer(1), EndColumn: intPointer(20),
	}
	expression := api.SourceRange{
		File: "/repo/writer.ts", StartLine: 1, StartColumn: intPointer(8),
		EndLine: intPointer(1), EndColumn: intPointer(14),
	}
	owner := semanticRef{sourceRef: contextSourceRef("owner", "", source)}
	target := semanticRef{sourceRef: contextSourceRef("target", "shared", source)}
	join := semanticFragmentJoin{
		Kind: "named-fragment", OwnerSourceRefID: "owner",
		OwnerTemplateRange: source, InterpolationIndex: 0,
		ExpressionRange: expression, TargetSourceRefID: "target",
		TargetTemplateRange: source, Proof: "semantic-exact",
	}
	if !validSemanticJoin(owner, target, join) {
		t.Fatal("exact same-context join was rejected")
	}

	mutations := map[string]func(*api.ProjectSourceRef){
		"role":      func(ref *api.ProjectSourceRef) { ref.Role = "system" },
		"property":  func(ref *api.ProjectSourceRef) { ref.Property = "system" },
		"lifecycle": func(ref *api.ProjectSourceRef) { ref.Metadata["promptText"].(map[string]any)["lifecycle"] = "dynamic" },
		"symbol":    func(ref *api.ProjectSourceRef) { ref.Symbol = "" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			changed := target
			changed.sourceRef = contextSourceRef("target", "shared", source)
			mutate(&changed.sourceRef)
			if validSemanticJoin(owner, changed, join) {
				t.Fatal("cross-context join was accepted")
			}
		})
	}
}

func TestSemanticJoinRejectsMalformedExpressionRanges(t *testing.T) {
	t.Parallel()

	source := api.SourceRange{
		File: "/repo/writer.ts", StartLine: 1, StartColumn: intPointer(1),
		EndLine: intPointer(1), EndColumn: intPointer(20),
	}
	owner := semanticRef{sourceRef: contextSourceRef("owner", "", source)}
	target := semanticRef{sourceRef: contextSourceRef("target", "shared", source)}
	join := semanticFragmentJoin{
		Kind: "named-fragment", OwnerSourceRefID: "owner",
		OwnerTemplateRange: source, InterpolationIndex: 0,
		ExpressionRange: api.SourceRange{
			File: "/repo/writer.ts", StartLine: 1, StartColumn: intPointer(8),
			EndLine: intPointer(1), EndColumn: intPointer(14),
		},
		TargetSourceRefID: "target", TargetTemplateRange: source,
		Proof: "semantic-exact",
	}

	for name, mutate := range map[string]func(*api.SourceRange){
		"zero-width": func(value *api.SourceRange) {
			value.EndColumn = intPointer(*value.StartColumn)
		},
		"reversed": func(value *api.SourceRange) {
			value.StartColumn, value.EndColumn = value.EndColumn, value.StartColumn
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := join
			mutate(&changed.ExpressionRange)
			if validSemanticJoin(owner, target, changed) {
				t.Fatal("malformed expression range was accepted")
			}
		})
	}
}

func contextSourceRef(
	id, symbol string,
	source api.SourceRange,
) api.ProjectSourceRef {
	sourceKind := "owner"
	if symbol != "" {
		sourceKind = "named-fragment"
	}
	return api.ProjectSourceRef{
		ID: id, Role: "prompt", Property: "prompt", Symbol: symbol,
		Snippet:  &api.SourceSnippet{Source: "md`${shared}`", Range: source},
		Fidelity: "resolved",
		Metadata: map[string]any{"promptText": map[string]any{
			"tag": "md", "language": "markdown", "lifecycle": "static",
			"sourceKind": sourceKind,
		}},
	}
}
