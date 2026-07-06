package eventwire

import "testing"

func TestProjectIndexPatchStreamCollectorUsesTerminalSemanticSourceProfile(t *testing.T) {
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})

	events := []map[string]any{
		{
			"protocolVersion": 2,
			"type":            "phase:start",
			"transactionId":   "tx-ast",
			"phase":           "ast",
			"root":            "/repo",
			"startedAt":       "2026-07-06T10:00:00.000Z",
		},
		{
			"protocolVersion": 2,
			"type":            "sourceProfile:batch",
			"transactionId":   "tx-ast",
			"sequence":        0,
			"files": []map[string]any{
				{
					"file":        "/repo/src/writer.ts",
					"sourceHash":  "hash-writer",
					"sourceBytes": 12,
				},
			},
		},
		{
			"protocolVersion": 2,
			"type":            "phase:done",
			"transactionId":   "tx-ast",
			"phase":           "ast",
			"patch": map[string]any{
				"schemaVersion": 1,
				"phase":         "ast",
				"project":       map[string]any{"root": "/repo"},
				"startedAt":     "2026-07-06T10:00:00.000Z",
				"finishedAt":    "2026-07-06T10:00:00.001Z",
				"status":        "partial",
				"semanticSourceProfile": map[string]any{
					"files": []map[string]any{
						{
							"file":        "/repo/src/writer.ts",
							"sourceHash":  "hash-writer",
							"sourceBytes": 12,
						},
					},
					"dependencyClosure": []string{"/repo/src/helper.ts", "/repo/src/writer.ts"},
					"sourceBytes":       48,
					"complete":          false,
				},
			},
			"summary": map[string]any{"factCount": 0},
		},
	}

	for _, event := range events {
		if err := collector.Handle(mustMarshalWorkerEvent(t, event)); err != nil {
			t.Fatalf("Handle(%s) error = %v", event["type"], err)
		}
	}
	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("Patches error = %v", err)
	}
	profile := patches[0].SemanticSourceProfile
	if profile == nil {
		t.Fatal("semantic source profile is nil")
	}
	if profile.Complete {
		t.Fatalf("semantic source profile complete = true, want false")
	}
	if got, want := profile.DependencyClosure, []string{"/repo/src/helper.ts", "/repo/src/writer.ts"}; !equalStringSlices(got, want) {
		t.Fatalf("semantic source profile dependencyClosure = %v, want %v", got, want)
	}
	if profile.SourceBytes != 48 {
		t.Fatalf("semantic source profile sourceBytes = %d, want 48", profile.SourceBytes)
	}
}

func equalStringSlices(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
