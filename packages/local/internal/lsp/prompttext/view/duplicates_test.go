package view

import "testing"

func TestDuplicateSourceRefInvalidatesDependentFragmentJoin(t *testing.T) {
	owner := PromptTextSourceRef{Key: SourceRefKey{
		DefinitionID: "prompt:owner", SourceRefID: "owner",
	}, SourceKind: PromptTextSourceOwner}
	target := PromptTextSourceRef{Key: SourceRefKey{
		DefinitionID: "prompt:owner", SourceRefID: "target",
	}, SourceKind: PromptTextSourceNamedFragment, Symbol: "target"}
	join := testJoin("owner", "target", 0)
	view := normalizedView{
		View: View{
			PromptTextRefs: []PromptTextSourceRef{owner, owner, target},
			FragmentJoins:  []FragmentJoin{join},
		},
		definitionSignatures: map[string]string{},
		siteSignatures:       map[string]string{},
		refSignatures: map[SourceRefKey]string{
			owner.Key:  "owner",
			target.Key: "target",
		},
		joinSignatures: map[FragmentJoinKey]string{
			join.Key: "join",
		},
		refactorSignatures: map[SourceRefKey]string{},
	}

	invalidateDuplicateRecords(&view)

	if len(view.PromptTextRefs) != 1 ||
		view.PromptTextRefs[0].Key != target.Key ||
		len(view.FragmentJoins) != 0 {
		t.Fatalf("normalized duplicates = %#v", view.View)
	}
	if _, retained := view.refSignatures[owner.Key]; retained {
		t.Fatal("duplicate source-ref signature remained addressable")
	}
}
