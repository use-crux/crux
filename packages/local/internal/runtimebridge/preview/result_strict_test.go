package preview

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDecodeResponseRejectsIdentityNullCoverageAndUTF16Drift(t *testing.T) {
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
				inspection(result)["prompt"] = nil
			}),
			commandID: "cmd", targetID: "prompt:x", revision: 1,
		},
		{
			name: "wrong coverage",
			result: withResult(valid, func(result map[string]any) {
				system(result)["coverage"] = "partial"
			}),
			commandID: "cmd", targetID: "prompt:x", revision: 1,
		},
		{
			name: "mid-surrogate boundary",
			result: readyResult("prompt:x", 1, "😀", []any{
				map[string]any{
					"kind": "static", "startUtf16": 0, "endUtf16": 1,
				},
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
	text := strings.Repeat("x", 524_277)
	exactStrings := readyResult("pp", 1, text, []any{
		map[string]any{
			"kind": "static", "startUtf16": 0, "endUtf16": len(text),
		},
	})
	if countStringBytes(mustJSON(exactStrings)) != MaxResultStringBytes {
		t.Fatal("aggregate-string fixture is not exact")
	}
	if _, err := DecodeResponse(
		resultEnvelope("cmd", exactStrings), "cmd", "pp", 1,
	); err != nil {
		t.Fatalf("exact aggregate strings rejected: %v", err)
	}
	overflowStrings := readyResult("pp", 1, text+"x", []any{
		map[string]any{
			"kind": "static", "startUtf16": 0, "endUtf16": len(text) + 1,
		},
	})
	if _, err := DecodeResponse(
		resultEnvelope("cmd", overflowStrings), "cmd", "pp", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("aggregate overflow error = %v", err)
	}

	exactSegments := segmentedResult(MaxResultSegments)
	if _, err := DecodeResponse(
		resultEnvelope("cmd", exactSegments), "cmd", "prompt:x", 1,
	); err != nil {
		t.Fatalf("exact segments rejected: %v", err)
	}
	overflowSegments := segmentedResult(MaxResultSegments + 1)
	if _, err := DecodeResponse(
		resultEnvelope("cmd", overflowSegments), "cmd", "prompt:x", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("segment overflow error = %v", err)
	}
}

func TestDecodeResponseCompactResultBytesAtEquality(t *testing.T) {
	targetID, result := exactResultSize(t)
	raw := resultEnvelope("cmd", result)
	if _, err := DecodeResponse(raw, "cmd", targetID, 1); err != nil {
		t.Fatalf("exact compact result rejected: %v", err)
	}
	result["targetId"] = targetID + "x"
	if _, err := DecodeResponse(
		resultEnvelope("cmd", result), "cmd", targetID+"x", 1,
	); !IsFailure(err, "invalid_response") {
		t.Fatalf("compact result overflow error = %v", err)
	}
}

func readyResult(
	targetID string,
	revision uint64,
	text string,
	segments []any,
) map[string]any {
	parts := []any{}
	if text != "" {
		parts = append(parts, map[string]any{
			"source": "s", "text": text, "tokens": 0, "skipped": false,
			"segments": segments,
		})
	}
	return map[string]any{
		"status": "ready", "targetId": targetID,
		"catalogueRevision": revision,
		"inspection": map[string]any{
			"system": map[string]any{
				"text": text, "tokens": 0, "coverage": "complete",
				"parts": parts,
			},
			"totalTokens": 0, "droppedContexts": []any{},
			"excludedContexts": []any{},
		},
	}
}

func segmentedResult(count int) map[string]any {
	segments := make([]any, count)
	for index := range segments {
		segments[index] = map[string]any{
			"kind": "static", "startUtf16": index, "endUtf16": index + 1,
		}
	}
	return readyResult("prompt:x", 1, strings.Repeat("x", count), segments)
}

func exactResultSize(t *testing.T) (string, map[string]any) {
	t.Helper()
	count := MaxResultBytes / 12
	for attempt := 0; attempt < 20; attempt++ {
		text := strings.Repeat("\x00", count)
		result := readyResult("p", 1, text, []any{
			map[string]any{
				"kind": "static", "startUtf16": 0, "endUtf16": count,
			},
		})
		remaining := MaxResultBytes - len(mustJSON(result))
		if remaining >= 0 && remaining < 512 {
			targetID := strings.Repeat("p", remaining+1)
			result["targetId"] = targetID
			if len(mustJSON(result)) == MaxResultBytes {
				return targetID, result
			}
		}
		if remaining < 0 {
			count += (remaining / 12) - 1
		} else {
			count += max(1, (remaining-256)/12)
		}
	}
	t.Fatal("could not construct exact compact result")
	return "", nil
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

func inspection(result map[string]any) map[string]any {
	return result["inspection"].(map[string]any)
}

func system(result map[string]any) map[string]any {
	return inspection(result)["system"].(map[string]any)
}

func mustJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return data
}
