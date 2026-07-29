package prompttext

import "testing"

func TestLatestRunLinkProjectsSharedOwnerProofWithoutStaticOnlyVariant(t *testing.T) {
	ready := latestRunLinkFromOwner(OwnerAtResult{
		Kind: OwnerAtReady, DefinitionID: "prompt:greeting",
	})
	if ready.Kind != LatestRunLinkReady ||
		ready.DefinitionID != "prompt:greeting" {
		t.Fatalf("ready = %#v", ready)
	}

	for _, reason := range []string{
		"context-owner",
		"named-fragment",
		"anonymous-fragment",
		"ownerless",
	} {
		result := latestRunLinkFromOwner(OwnerAtResult{
			Kind: OwnerAtStaticOnly, Reason: reason,
		})
		if result.Kind != LatestRunLinkUnavailable || result.Reason != reason {
			t.Fatalf("%s result = %#v", reason, result)
		}
	}
}
