package preview

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateDispatchStructuralLimitsAtEquality(t *testing.T) {
	nested := func(containers int) map[string]any {
		root := map[string]any{}
		current := root
		for index := 1; index < containers; index++ {
			child := map[string]any{}
			current["value"] = child
			current = child
		}
		return root
	}
	nodes := func(elements int) map[string]any {
		return map[string]any{"values": make([]any, elements)}
	}
	keys := func(count int) map[string]any {
		input := make(map[string]any, count)
		for index := 0; index < count; index++ {
			input[jsonNumber(index)] = nil
		}
		return input
	}
	weighted := func(secondLength int) map[string]any {
		return map[string]any{
			"a": strings.Repeat("a", MaxStringBytes),
			"b": strings.Repeat("b", secondLength),
		}
	}

	for _, input := range []map[string]any{
		nested(MaxDepth),
		nodes(MaxNodes - 2),
		keys(MaxKeys),
		{strings.Repeat("k", MaxKeyBytes): true},
		{"value": strings.Repeat("x", MaxStringBytes)},
		weighted(65_529),
	} {
		if err := validateInput(input); err != nil {
			t.Fatalf("equality input rejected: %v", err)
		}
	}
	for _, input := range []map[string]any{
		nested(MaxDepth + 1),
		nodes(MaxNodes - 1),
		keys(MaxKeys + 1),
		{strings.Repeat("k", MaxKeyBytes+1): true},
		{"value": strings.Repeat("x", MaxStringBytes+1)},
		weighted(65_530),
	} {
		if err := validateInput(input); !IsFailure(err, "invalid_request") {
			t.Fatalf("overflow input error = %v", err)
		}
	}
}

func TestValidateDispatchRequestBytesAtEquality(t *testing.T) {
	targetID, payload := exactRequestSize(t)
	if err := ValidateDispatch(targetID, "node", 1, payload, 1_000); err != nil {
		t.Fatalf("exact request rejected: %v", err)
	}
	if err := ValidateDispatch(targetID+"x", "node", 1, payload, 1_000); !IsFailure(err, "invalid_request") {
		t.Fatalf("overflow request error = %v", err)
	}
}

func validateInput(input map[string]any) error {
	payload, _ := json.Marshal(map[string]any{"input": input})
	return ValidateDispatch("prompt:x", "node", 1, payload, 1_000)
}

func exactRequestSize(t *testing.T) (string, json.RawMessage) {
	t.Helper()
	count := MaxRequestBytes / 6
	for attempt := 0; attempt < 20; attempt++ {
		payload, _ := json.Marshal(map[string]any{
			"input": map[string]any{"value": strings.Repeat("\x00", count)},
		})
		request := Request{
			Type: "command.request", CommandID: "cmd", Command: Command,
			TargetID: "p", CatalogueRevision: 1, Payload: payload,
			DeadlineMS: 1_000,
		}
		encoded, _ := json.Marshal(request)
		remaining := MaxRequestBytes - len(encoded)
		if remaining >= 0 && remaining < 512 {
			return strings.Repeat("p", remaining+1), payload
		}
		count += sizeAdjustment(remaining)
	}
	t.Fatal("could not construct exact request")
	return "", nil
}

func sizeAdjustment(remaining int) int {
	if remaining < 0 {
		return (remaining / 6) - 1
	}
	return max(1, (remaining-256)/6)
}

func jsonNumber(value int) string {
	data, _ := json.Marshal(value)
	return string(data)
}
