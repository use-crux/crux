package eventwire

import "testing"

func TestCollectorDistinguishesDeclaredEmptyDiagnosticsFromLegacyOmission(t *testing.T) {
	t.Parallel()

	declared := collectFactGroupPatch(t, []string{"diagnostics"})
	if declared.Facts.Diagnostics == nil || len(declared.Facts.Diagnostics) != 0 {
		t.Fatalf("declared diagnostics = %#v, want nonnil empty", declared.Facts.Diagnostics)
	}

	legacy := collectFactGroupPatch(t, nil)
	if legacy.Facts.Diagnostics != nil {
		t.Fatalf("legacy diagnostics = %#v, want nil omission", legacy.Facts.Diagnostics)
	}
}

func TestCollectorReconstructsEveryDeclaredEmptyArrayGroup(t *testing.T) {
	t.Parallel()

	patch := collectFactGroupPatch(t, []string{
		"prompts",
		"contexts",
		"tools",
		"definitions",
		"relations",
		"sourceRefs",
		"diagnostics",
		"lintFindings",
		"ruleDescriptors",
		"sources",
	})

	assertNonNilEmpty(t, "prompts", patch.Facts.Prompts)
	assertNonNilEmpty(t, "contexts", patch.Facts.Contexts)
	assertNonNilEmpty(t, "tools", patch.Facts.Tools)
	assertNonNilEmpty(t, "definitions", patch.Facts.Definitions)
	assertNonNilEmpty(t, "relations", patch.Facts.Relations)
	assertNonNilEmpty(t, "sourceRefs", patch.Facts.SourceRefs)
	assertNonNilEmpty(t, "diagnostics", patch.Facts.Diagnostics)
	assertNonNilEmpty(t, "lintFindings", patch.Facts.LintFindings)
	assertNonNilEmpty(t, "ruleDescriptors", patch.Facts.RuleDescriptors)
	assertNonNilEmpty(t, "sources", patch.Facts.Sources)
}

func TestCollectorRejectsInconsistentFactGroupTransactionsAtomically(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		factGroups any
		envelopes  []map[string]any
		factCount  int
	}{
		{name: "null", factGroups: nil},
		{
			name:       "undeclared envelope",
			factGroups: []string{},
			envelopes:  []map[string]any{diagnosticFactEnvelope()},
			factCount:  1,
		},
		{
			name:       "missing singleton",
			factGroups: []string{"lint"},
		},
		{
			name:       "duplicate singleton",
			factGroups: []string{"lint"},
			envelopes: []map[string]any{
				lintFactEnvelope("lint:one"),
				lintFactEnvelope("lint:two"),
			},
			factCount: 2,
		},
		{
			name:       "fact count mismatch",
			factGroups: []string{},
			factCount:  1,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			collector := startedFactGroupCollector(t)
			if len(test.envelopes) > 0 {
				batch := map[string]any{
					"protocolVersion": 3,
					"type":            "fact:batch",
					"transactionId":   "tx-fact-groups",
					"sequence":        0,
					"facts":           test.envelopes,
				}
				if err := collector.Handle(mustMarshalWorkerEvent(t, batch)); err != nil {
					t.Fatalf("handle fact:batch: %v", err)
				}
			}

			err := collector.Handle(mustMarshalWorkerEvent(
				t,
				factGroupDoneEvent(test.factGroups, test.factCount),
			))
			if err == nil {
				t.Fatal("inconsistent phase:done succeeded")
			}
			if collector.CompletedPatchCount() != 0 {
				t.Fatalf("completed patches = %d, want zero", collector.CompletedPatchCount())
			}
			if _, err := collector.Patches(); err == nil {
				t.Fatal("incomplete rejected transaction exposed patches")
			}
		})
	}
}

func TestCollectorRequiresNonNullFactCount(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{
			name: "missing",
			mutate: func(done map[string]any) {
				delete(done["summary"].(map[string]any), "factCount")
			},
		},
		{
			name: "null",
			mutate: func(done map[string]any) {
				done["summary"].(map[string]any)["factCount"] = nil
			},
		},
		{
			name: "null summary",
			mutate: func(done map[string]any) {
				done["summary"] = nil
			},
		},
		{
			name: "missing summary",
			mutate: func(done map[string]any) {
				delete(done, "summary")
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			collector := startedFactGroupCollector(t)
			done := factGroupDoneEvent([]string{}, 0)
			test.mutate(done)
			if err := collector.Handle(mustMarshalWorkerEvent(t, done)); err == nil {
				t.Fatal("phase:done without a required factCount succeeded")
			}
			if collector.CompletedPatchCount() != 0 {
				t.Fatalf("completed patches = %d, want zero", collector.CompletedPatchCount())
			}
		})
	}
}

func collectFactGroupPatch(t *testing.T, factGroups []string) IndexPatch {
	t.Helper()
	collector := startedFactGroupCollector(t)
	done := factGroupDoneEvent(factGroups, 0)
	if factGroups == nil {
		summary := done["summary"].(map[string]any)
		delete(summary, "factGroups")
	}
	if err := collector.Handle(mustMarshalWorkerEvent(t, done)); err != nil {
		t.Fatalf("handle phase:done: %v", err)
	}
	patches, err := collector.Patches()
	if err != nil {
		t.Fatalf("collect patches: %v", err)
	}
	if len(patches) != 1 {
		t.Fatalf("patches = %#v, want one", patches)
	}
	return patches[0]
}

func startedFactGroupCollector(t *testing.T) *ProjectIndexPatchStreamCollector {
	t.Helper()
	collector := NewProjectIndexPatchStreamCollector(ProjectIndexPatchStreamOptions{Root: "/repo"})
	start := map[string]any{
		"protocolVersion": 3,
		"type":            "phase:start",
		"transactionId":   "tx-fact-groups",
		"phase":           "semantic",
		"root":            "/repo",
		"startedAt":       "2026-07-28T00:00:00Z",
	}
	if err := collector.Handle(mustMarshalWorkerEvent(t, start)); err != nil {
		t.Fatalf("handle phase:start: %v", err)
	}
	return collector
}

func factGroupDoneEvent(factGroups any, factCount int) map[string]any {
	return map[string]any{
		"protocolVersion": 3,
		"type":            "phase:done",
		"transactionId":   "tx-fact-groups",
		"phase":           "semantic",
		"patch": map[string]any{
			"schemaVersion": 1,
			"phase":         "semantic",
			"project":       map[string]any{"root": "/repo"},
			"startedAt":     "2026-07-28T00:00:00Z",
			"finishedAt":    "2026-07-28T00:00:01Z",
			"status":        "ok",
		},
		"summary": map[string]any{
			"factCount":  factCount,
			"factGroups": factGroups,
		},
	}
}

func diagnosticFactEnvelope() map[string]any {
	return factEnvelope("diagnostics:one", "diagnostics", map[string]any{
		"id":       "diagnostic:one",
		"severity": "error",
		"code":     "test",
		"message":  "test",
	})
}

func lintFactEnvelope(id string) map[string]any {
	return factEnvelope(id, "lint", map[string]any{"profile": "recommended"})
}

func factEnvelope(id, kind string, fact map[string]any) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"factId":        id,
		"kind":          kind,
		"phase":         "semantic",
		"projectRoot":   "/repo",
		"producer": map[string]any{
			"name":    "@use-crux/indexer",
			"version": "test",
		},
		"fidelity":   "inferred",
		"provenance": map[string]any{"kind": "runtime", "attribute": "test"},
		"fact":       fact,
	}
}

func assertNonNilEmpty[T any](t *testing.T, name string, values []T) {
	t.Helper()
	if values == nil || len(values) != 0 {
		t.Fatalf("%s = %#v, want nonnil empty", name, values)
	}
}
