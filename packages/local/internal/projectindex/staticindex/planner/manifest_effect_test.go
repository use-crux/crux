package planner

import "testing"

func TestEffectStaticManifestCoverage(t *testing.T) {
	if !contains(defaultCallNames, "effect") {
		t.Fatal(`defaultCallNames missing "effect"`)
	}
	if !contains(defaultCallInterestNames, "effect") {
		t.Fatal(`defaultCallInterestNames missing "effect"`)
	}
	if !contains(defaultCallNames, "rollbackOnError") {
		t.Fatal(`defaultCallNames missing "rollbackOnError"`)
	}
	if !contains(defaultCallInterestNames, "rollbackOnError") {
		t.Fatal(`defaultCallInterestNames missing "rollbackOnError"`)
	}

	foundEffect := false
	foundBoundary := false
	for _, interest := range defaultCallInterests() {
		switch interest.Name {
		case "effect":
			foundEffect = true
			if interest.ConfigArg == nil || *interest.ConfigArg != 2 {
				t.Fatalf("effect ConfigArg = %v, want 2", interest.ConfigArg)
			}
			for _, property := range []string{"version", "recover", "resource"} {
				if !contains(interest.Properties, property) {
					t.Fatalf("effect Properties = %v, missing %q", interest.Properties, property)
				}
			}
		case "rollbackOnError":
			foundBoundary = true
			if interest.ConfigArg == nil || *interest.ConfigArg != 1 {
				t.Fatalf("rollbackOnError ConfigArg = %v, want 1", interest.ConfigArg)
			}
			if !contains(interest.Properties, "recovery") {
				t.Fatalf("rollbackOnError Properties = %v", interest.Properties)
			}
		}
		if interest.Name == "effect" || interest.Name == "rollbackOnError" {
			if !contains(interest.ImportFrom, "@use-crux/core") || !contains(interest.ImportFrom, "@use-crux/core/effect") {
				t.Fatalf("%s ImportFrom = %v", interest.Name, interest.ImportFrom)
			}
		}
	}
	if !foundEffect || !foundBoundary {
		t.Fatalf("effect interests: effect=%t rollbackOnError=%t", foundEffect, foundBoundary)
	}
}
