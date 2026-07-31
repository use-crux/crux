package planner

import "testing"

func TestEffectStaticManifestCoverage(t *testing.T) {
	if !contains(defaultCallNames, "effect") {
		t.Fatal(`defaultCallNames missing "effect"`)
	}
	if !contains(defaultCallInterestNames, "effect") {
		t.Fatal(`defaultCallInterestNames missing "effect"`)
	}

	for _, interest := range defaultCallInterests() {
		if interest.Name != "effect" {
			continue
		}
		if interest.ConfigArg == nil || *interest.ConfigArg != 2 {
			t.Fatalf("effect ConfigArg = %v, want 2", interest.ConfigArg)
		}
		if !contains(interest.ImportFrom, "@use-crux/core") || !contains(interest.ImportFrom, "@use-crux/core/effect") {
			t.Fatalf("effect ImportFrom = %v", interest.ImportFrom)
		}
		for _, property := range []string{"version", "recover", "resource"} {
			if !contains(interest.Properties, property) {
				t.Fatalf("effect Properties = %v, missing %q", interest.Properties, property)
			}
		}
		return
	}
	t.Fatal("effect call interest missing")
}
