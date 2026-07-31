package preview

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeResponseRejectsIdentityNullAndInvalidPreviewValues(t *testing.T) {
	valid := readyResult("prompt:x", 1, "", []any{})
	for _, test := range []struct {
		name      string
		result    map[string]any
		commandID string
		targetID  string
		revision  uint64
	}{
		{
			name: "command mismatch", result: valid,
			commandID: "other", targetID: "prompt:x", revision: 1,
		},
		{
			name: "target mismatch", result: valid,
			commandID: "cmd", targetID: "prompt:y", revision: 1,
		},
		{
			name: "revision mismatch", result: valid,
			commandID: "cmd", targetID: "prompt:x", revision: 2,
		},
		{
			name: "optional null",
			result: withResult(valid, func(result map[string]any) {
				preview(result)["model"] = nil
			}),
			commandID: "cmd", targetID: "prompt:x", revision: 1,
		},
		{
			name: "wrong measurement",
			result: withResult(valid, func(result map[string]any) {
				preview(result)["measurement"] = "partial"
			}),
			commandID: "cmd", targetID: "prompt:x", revision: 1,
		},
		{
			name: "invalid contribution boundary",
			result: withResult(valid, func(result map[string]any) {
				result["contributions"] = []any{map[string]any{
					"id": "context:history", "boundary": "protected",
					"representations": []any{"full"},
				}}
			}),
			commandID: "cmd", targetID: "prompt:x", revision: 1,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := resultEnvelope("cmd", test.result)
			if _, err := DecodeResponse(
				raw, test.commandID, test.targetID, test.revision,
			); !IsFailure(err, "invalid_response") {
				t.Fatalf("DecodeResponse error = %v", err)
			}
		})
	}
}

func TestDecodeResponseStrictValidationAndErrorVariants(t *testing.T) {
	validation := map[string]any{
		"status": "validation-error", "targetId": "prompt:x",
		"catalogueRevision": 1,
		"issues": []any{map[string]any{
			"code": "too_small", "path": []any{"name", 0},
			"message": "Required.",
		}},
		"omittedIssueCount": 0,
	}
	if _, err := DecodeResponse(
		resultEnvelope("cmd", validation), "cmd", "prompt:x", 1,
	); err != nil {
		t.Fatalf("valid validation result rejected: %v", err)
	}
	invalidValidation := withResult(validation, func(result map[string]any) {
		result["issues"] = []any{map[string]any{
			"code": "custom", "path": []any{-1}, "message": "Invalid.",
		}}
	})
	if _, err := DecodeResponse(
		resultEnvelope("cmd", invalidValidation), "cmd", "prompt:x", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("invalid validation error = %v", err)
	}

	validError := errorEnvelope("cmd", map[string]any{
		"code": "inspection_failed", "message": "Application failed.",
		"details": map[string]any{
			"targetId": "prompt:x", "expectedCatalogueRevision": 1,
			"actualCatalogueRevision": 2,
		},
	})
	if decoded, err := DecodeResponse(validError, "cmd", "prompt:x", 1); err != nil ||
		decoded.Error == nil {
		t.Fatalf("valid error rejected: %#v, %v", decoded, err)
	}
	for _, raw := range [][]byte{
		errorEnvelope("cmd", map[string]any{
			"code": "private", "message": "failed",
		}),
		errorEnvelope("cmd", map[string]any{
			"code": "inspection_failed", "message": "failed",
			"details": map[string]any{"targetId": "prompt:y"},
		}),
		errorEnvelope("cmd", map[string]any{
			"code": "inspection_failed", "message": "failed", "private": true,
		}),
	} {
		if _, err := DecodeResponse(raw, "cmd", "prompt:x", 1); !IsFailure(err, "invalid_response") {
			t.Fatalf("invalid error accepted: %s", raw)
		}
	}
}

func TestDecodeResponseResultLimitsAtEquality(t *testing.T) {
	exactStrings := resultWithStringBytes(t, MaxResultStringBytes)
	if countStringBytes(mustJSON(exactStrings)) != MaxResultStringBytes {
		t.Fatal("aggregate-string fixture is not exact")
	}
	if _, err := DecodeResponse(
		resultEnvelope("cmd", exactStrings), "cmd", "pp", 1,
	); err != nil {
		t.Fatalf("exact aggregate strings rejected: %v", err)
	}
	overflowStrings := resultWithStringBytes(t, MaxResultStringBytes+1)
	if _, err := DecodeResponse(
		resultEnvelope("cmd", overflowStrings), "cmd", "pp", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("aggregate overflow error = %v", err)
	}

	exactContributions := contributionResult(1024)
	if _, err := DecodeResponse(
		resultEnvelope("cmd", exactContributions), "cmd", "prompt:x", 1,
	); err != nil {
		t.Fatalf("exact contributions rejected: %v", err)
	}
	overflowContributions := contributionResult(1025)
	if _, err := DecodeResponse(
		resultEnvelope("cmd", overflowContributions), "cmd", "prompt:x", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("contribution overflow error = %v", err)
	}
}

func readyResult(
	targetID string,
	revision uint64,
	text string,
	segments []any,
) map[string]any {
	_ = text
	_ = segments
	return map[string]any{
		"status": "ready", "targetId": targetID,
		"catalogueRevision": revision,
		"preview": map[string]any{
			"status": "fits", "measurement": "exact",
			"adaptations": []any{}, "warnings": []any{},
			"diagnostics": []any{},
		},
		"contributions": []any{},
	}
}

func contributionResult(count int) map[string]any {
	result := readyResult("prompt:x", 1, "", nil)
	contributions := make([]any, count)
	for index := range contributions {
		contributions[index] = map[string]any{
			"id": "x", "boundary": "required", "representations": []any{"full"},
		}
	}
	result["contributions"] = contributions
	return result
}

func resultWithStringBytes(t *testing.T, total int) map[string]any {
	t.Helper()
	result := readyResult("pp", 1, "", nil)
	remaining := total - countStringBytes(mustJSON(result))
	diagnostics := []any{}
	for index := 0; remaining > 0; index++ {
		base := map[string]any{"id": "i", "code": "c", "message": ""}
		remaining -= 2
		length := min(remaining, 2048)
		base["message"] = strings.Repeat("x", length)
		remaining -= length
		diagnostics = append(diagnostics, base)
	}
	preview(result)["diagnostics"] = diagnostics
	if countStringBytes(mustJSON(result)) != total {
		t.Fatal("could not construct aggregate-string fixture")
	}
	return result
}

func resultEnvelope(commandID string, result map[string]any) []byte {
	return mustJSON(map[string]any{
		"type": "command.result", "commandId": commandID, "result": result,
	})
}

func errorEnvelope(commandID string, body map[string]any) []byte {
	return mustJSON(map[string]any{
		"type": "command.error", "commandId": commandID, "error": body,
	})
}

func withResult(
	value map[string]any,
	mutate func(map[string]any),
) map[string]any {
	cloned := map[string]any{}
	data := mustJSON(value)
	_ = json.Unmarshal(data, &cloned)
	mutate(cloned)
	return cloned
}

func preview(result map[string]any) map[string]any {
	return result["preview"].(map[string]any)
}

func mustJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
