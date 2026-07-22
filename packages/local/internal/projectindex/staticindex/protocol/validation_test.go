package protocol

import "testing"

func TestValidateLintSuppressionsRejectsUnsupportedScope(t *testing.T) {
	err := ValidateLintSuppressions([]LintSuppression{{
		Scope: LintSuppressionScope("next-lineage"),
	}})

	if err == nil {
		t.Fatal("ValidateLintSuppressions error = nil, want unsupported scope rejected")
	}
}
