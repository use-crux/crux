package planner

import (
	"strings"
	"testing"
)

func TestMediaClassifierParticipatesInStaticPlanningAndCacheIdentity(t *testing.T) {
	if !contains(defaultCallNames, "mediaClassifier") {
		t.Fatal(`defaultCallNames missing "mediaClassifier"`)
	}
	if !contains(defaultCallInterestNames, "mediaClassifier") {
		t.Fatal(`defaultCallInterestNames missing "mediaClassifier"`)
	}

	var foundProjection bool
	for _, input := range DefaultCacheCompilerInputs() {
		if strings.Contains(
			string(input),
			`"name":"safety-strategy-facts","version":"3"`,
		) {
			foundProjection = true
		}
	}
	if !foundProjection {
		t.Fatal(`cache compiler inputs missing "safety-strategy-facts"`)
	}
}
