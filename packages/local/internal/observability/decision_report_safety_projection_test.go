package observability

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// These tests exercise the content-free Safety projection carried by Run Detail.

func TestProjectRunDetailMarshalsGuardrailSafetyDecision(t *testing.T) {
	started := time.Date(2026, 7, 21, 9, 0, 0, 0, time.UTC)
	runID := "run_guardrail_safety"
	traceID := "trace_guardrail_safety"
	generation := requestGenerationSpan(
		runID,
		traceID,
		"span_generation",
		"",
		"generate guarded answer",
		started,
		"guarded.answer",
	)
	guardrail := SpanSummary{
		RunID:        runID,
		TraceID:      traceID,
		SpanID:       "span_guardrail",
		ParentSpanID: generation.SpanID,
		Family:       "guardrail",
		Primitive:    "guardrail.run",
		Name:         "sanitize-retrieval",
		Status:       "ok",
		StartedAt:    started.Add(10 * time.Millisecond).Format(time.RFC3339Nano),
		EndedAt:      started.Add(20 * time.Millisecond).Format(time.RFC3339Nano),
		DurationMs:   10,
		Attributes: json.RawMessage(`{
			"boundary":"model.input.text",
			"mode":"enforce",
			"action":"transform",
			"inputSource":"retrieval",
			"inputOriginKind":"retrieval-context",
			"retrieverId":"docs",
			"blockIndex":0,
			"segmentIndex":3,
			"content":"SECRET_CONTENT",
			"arguments":{"query":"SECRET_ARGUMENT"},
			"result":"SECRET_RESULT",
			"url":"https://example.invalid/SECRET_URL",
			"bytes":[83,69,67,82,69,84],
			"provider":{"id":"SECRET_PROVIDER"},
			"metadata":{"tenant":"SECRET_METADATA"}
		}`),
	}
	detail := ProjectRunDetail(Graph{
		Run: RunSummary{
			RunID:         runID,
			TraceID:       traceID,
			Name:          "guarded answer",
			RootPrimitive: "generation.call",
			Status:        "ok",
			StartedAt:     started.Format(time.RFC3339Nano),
			EndedAt:       started.Add(time.Second).Format(time.RFC3339Nano),
			DurationMs:    1000,
		},
		Spans: []SpanSummary{generation, guardrail},
	}, ProjectionOptions{Now: started.Add(2 * time.Second)})

	raw, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Root struct {
			DecisionReport struct {
				Decisions []struct {
					Safety map[string]any `json:"safety"`
				} `json:"decisions"`
			} `json:"decisionReport"`
		} `json:"root"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}

	if len(payload.Root.DecisionReport.Decisions) != 1 {
		t.Fatalf("marshalled decisions = %s, want one guardrail decision", raw)
	}
	want := map[string]any{
		"target": map[string]any{
			"id":    "model.input.text",
			"label": "Model input · Text",
		},
		"mode":    "enforce",
		"changed": true,
		"origin": map[string]any{
			"source":       "retrieval",
			"kind":         "retrieval-context",
			"retrieverId":  "docs",
			"blockIndex":   float64(0),
			"segmentIndex": float64(3),
		},
	}
	if got := payload.Root.DecisionReport.Decisions[0].Safety; !equalJSONValues(got, want) {
		t.Fatalf("marshalled safety = %#v, want %#v; run detail = %s", got, want, raw)
	} else {
		safetyJSON, err := json.Marshal(got)
		if err != nil {
			t.Fatal(err)
		}
		for _, forbidden := range []string{
			"content", "arguments", "result", "url", "bytes", "provider", "metadata", "SECRET_",
		} {
			if strings.Contains(string(safetyJSON), forbidden) {
				t.Fatalf("marshalled safety leaked %q: %s", forbidden, safetyJSON)
			}
		}
	}
}

func TestGuardrailSafetyDecisionProjectsUserMessageCoordinates(t *testing.T) {
	decision := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.input.text",
		"mode":"enforce",
		"action":"allow",
		"inputSource":"user",
		"inputOriginKind":"message",
		"messageIndex":0,
		"partIndex":2
	}`))
	if decision == nil {
		t.Fatal("safety decision is nil")
	}
	want := &TurnModelInputOrigin{
		Source:       "user",
		Kind:         "message",
		MessageIndex: intPointer(0),
		PartIndex:    intPointer(2),
	}
	if !equalJSONValues(decision.Origin, want) {
		t.Fatalf("origin = %#v, want %#v", decision.Origin, want)
	}
}

func TestGuardrailSafetyDecisionKeepsOnlyApplicableUserCoordinates(t *testing.T) {
	prompt := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.input.text",
		"mode":"enforce",
		"action":"allow",
		"inputSource":"user",
		"inputOriginKind":"prompt",
		"messageIndex":3,
		"partIndex":4
	}`))
	operation := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.input.media",
		"mode":"enforce",
		"action":"allow",
		"inputSource":"user",
		"inputOriginKind":"operation",
		"messageIndex":3,
		"partIndex":4
	}`))

	if prompt == nil || !equalJSONValues(prompt.Origin, &TurnModelInputOrigin{Source: "user", Kind: "prompt"}) {
		t.Fatalf("prompt origin = %#v, want source and kind only", prompt)
	}
	wantOperation := &TurnModelInputOrigin{
		Source:    "user",
		Kind:      "operation",
		PartIndex: intPointer(4),
	}
	if operation == nil || !equalJSONValues(operation.Origin, wantOperation) {
		t.Fatalf("operation origin = %#v, want %#v", operation, wantOperation)
	}
}

func TestGuardrailSafetyDecisionProjectsToolIdentifiers(t *testing.T) {
	decision := safetyDecisionForAttributes(json.RawMessage(`{
		"boundary":"model.input.text",
		"mode":"enforce",
		"action":"allow",
		"inputSource":"tool",
		"inputOriginKind":"tool-result",
		"toolName":"search",
		"toolCallId":"call-safe-1",
		"partIndex":1
	}`))
	if decision == nil {
		t.Fatal("safety decision is nil")
	}
	want := &TurnModelInputOrigin{
		Source:     "tool",
		Kind:       "tool-result",
		ToolName:   "search",
		ToolCallID: "call-safe-1",
		PartIndex:  intPointer(1),
	}
	if !equalJSONValues(decision.Origin, want) {
		t.Fatalf("origin = %#v, want %#v", decision.Origin, want)
	}
}

func TestGuardrailSafetyDecisionDistinguishesEnforcedAndReportedMutation(t *testing.T) {
	for _, action := range []string{"rewrite", "strip", "redact", "mask", "hash", "transform"} {
		t.Run(action, func(t *testing.T) {
			enforced := safetyDecisionForAttributes(json.RawMessage(`{
				"boundary":"model.input.text",
				"mode":"enforce",
				"action":"` + action + `"
			}`))
			reported := safetyDecisionForAttributes(json.RawMessage(`{
				"boundary":"model.input.text",
				"mode":"report",
				"action":"` + action + `"
			}`))
			if enforced == nil || !enforced.Changed {
				t.Fatalf("enforced %s = %#v, want changed", action, enforced)
			}
			if reported == nil || reported.Changed {
				t.Fatalf("reported %s = %#v, want unchanged", action, reported)
			}
		})
	}
}

func TestGuardrailSafetyDecisionKeepsMediaLocationSeparateFromMutation(t *testing.T) {
	decision := guardDecisionForSpan(
		SpanSummary{SpanID: "span_generation"},
		SpanSummary{
			SpanID:    "span_guardrail",
			Primitive: "guardrail.run",
			Status:    "ok",
			Attributes: json.RawMessage(`{
				"boundary":"model.input.media",
				"mode":"enforce",
				"action":"strip",
				"originKind":"message",
				"messageIndex":2,
				"partIndex":1,
				"mediaPartType":"image"
			}`),
		},
		"guardrail",
		"Guardrail",
	)

	if decision.Safety == nil || decision.Safety.Target.Label != "Model input · Media" || !decision.Safety.Changed {
		t.Fatalf("safety = %#v, want changed model-input media", decision.Safety)
	}
	if decision.Safety.Origin != nil {
		t.Fatalf("semantic origin = %#v, want absent without inputSource", decision.Safety.Origin)
	}
	if decision.Location == nil || decision.Location.Origin.MessageIndex == nil ||
		*decision.Location.Origin.MessageIndex != 2 || decision.Location.Origin.PartIndex != 1 {
		t.Fatalf("location = %#v, want independent message coordinates", decision.Location)
	}
}

func intPointer(value int) *int {
	return &value
}

func equalJSONValues(left, right any) bool {
	leftJSON, leftErr := json.Marshal(left)
	rightJSON, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && string(leftJSON) == string(rightJSON)
}
