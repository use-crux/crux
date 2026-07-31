package preview

import "testing"

func TestDecodeResponseReadyInputTokensAreOptionalAndNonnegative(t *testing.T) {
	base := readyResult("prompt:x", 1, "", []any{})
	for _, test := range []struct {
		name   string
		result map[string]any
		valid  bool
	}{
		{name: "omitted", result: base, valid: true},
		{
			name: "zero",
			result: withResult(base, func(result map[string]any) {
				preview(result)["inputTokens"] = 0
			}),
			valid: true,
		},
		{
			name: "negative",
			result: withResult(base, func(result map[string]any) {
				preview(result)["inputTokens"] = -1
			}),
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := DecodeResponse(
				resultEnvelope("cmd", test.result), "cmd", "prompt:x", 1,
			)
			if test.valid && err != nil {
				t.Fatalf("DecodeResponse rejected token budget: %v", err)
			}
			if !test.valid && !IsFailure(err, "invalid_response") {
				t.Fatalf("DecodeResponse error = %v, want invalid_response", err)
			}
		})
	}
}
